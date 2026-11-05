"""
Budgeted pair selection.

Replaces all-pairs rounds. Each officer gets a fixed number of comparisons, no
pair repeats, pairs never cross a grade band, and a set share of pairs cross
unit lines. All-pairs for 30 officers is 435 comparisons; 7 to 15 per officer is
105 to 225 (information paper, section 10).

Cross-unit links are scheduled first because they are what make ratings from
different units comparable at all (section 11). Small units can force the
realised share above the target: an officer whose unit is smaller than the
budget has to be compared outside it. The plan reports the realised share.
"""

from collections import defaultdict
from dataclasses import dataclass, field
from typing import Optional, Sequence

import numpy as np

MIN_POOL = 5  # information paper, section 14


@dataclass
class BandPlan:
    band: str
    officers: int
    budget: int
    pairs: list[tuple[int, int]] = field(default_factory=list)
    cross_unit_pairs: int = 0
    target_cross_unit_share: float = 0.0
    units: int = 0
    unit_groups: int = 0  # units joined into one scale by cross-unit links
    min_comparisons: int = 0
    max_comparisons: int = 0
    warnings: list[str] = field(default_factory=list)

    @property
    def realised_cross_unit_share(self) -> float:
        return self.cross_unit_pairs / len(self.pairs) if self.pairs else 0.0

    def summary(self) -> dict:
        return {
            "band": self.band,
            "officers": self.officers,
            "budget": self.budget,
            "pairs": len(self.pairs),
            "cross_unit_pairs": self.cross_unit_pairs,
            "target_cross_unit_share": self.target_cross_unit_share,
            "realised_cross_unit_share": self.realised_cross_unit_share,
            "units": self.units,
            "unit_groups": self.unit_groups,
            "min_comparisons": self.min_comparisons,
            "max_comparisons": self.max_comparisons,
            "warnings": self.warnings,
        }


def select_pairs(
    officers: Sequence[tuple[int, str, str]],
    comparisons_per_officer: int,
    cross_unit_share: float,
    seed: Optional[int] = None,
) -> list[BandPlan]:
    """
    Plan a round.

    Args:
        officers: (id, band, unit) for everyone in the round
        comparisons_per_officer: budget; capped at pool size minus one
        cross_unit_share: target share of pairs that cross unit lines, 0 to 1
        seed: fixes the plan

    Returns:
        One BandPlan per band, in band name order
    """
    rng = np.random.default_rng(seed)
    by_band: dict[str, list[tuple[int, str]]] = defaultdict(list)
    for officer_id, band, unit in officers:
        by_band[band].append((officer_id, unit))
    return [
        _plan_band(band, by_band[band], comparisons_per_officer, cross_unit_share, rng)
        for band in sorted(by_band)
    ]


def _plan_band(
    band: str,
    members: list[tuple[int, str]],
    budget: int,
    share: float,
    rng: np.random.Generator,
) -> BandPlan:
    n = len(members)
    plan = BandPlan(
        band=band, officers=n, budget=budget, target_cross_unit_share=share
    )
    ids = np.array([m[0] for m in members])
    unit_names = sorted({m[1] for m in members})
    units = np.array([unit_names.index(m[1]) for m in members])
    plan.units = len(unit_names)

    if n < 2:
        plan.warnings.append(f"{band}: {n} officer, nothing to compare")
        return plan
    if n < MIN_POOL:
        plan.warnings.append(f"{band}: {n} officers is under the pool of {MIN_POOL}")

    degree = min(budget, n - 1)
    if degree < budget:
        plan.warnings.append(
            f"{band}: budget capped at {degree}, the most a pool of {n} allows"
        )

    remaining = np.full(n, degree)
    paired = np.eye(n, dtype=bool)
    edges: list[tuple[int, int]] = []
    total = n * degree // 2
    target_cross = int(round(share * total))

    # Scheduled cross-unit links, then in-unit pairs, then whatever is left.
    # The last pass only finds work when a unit is too small to hold its budget.
    same_unit = units[:, None] == units[None, :]
    _add_pairs(target_cross, ~same_unit, remaining, paired, edges, rng)
    _add_pairs(total - len(edges), same_unit, remaining, paired, edges, rng)
    for unit in range(plan.units):  # stranded in-unit slots stay in the unit
        _repair_shortfalls(units == unit, remaining, paired, edges, rng)
    _add_pairs(
        total - len(edges), np.ones_like(paired), remaining, paired, edges, rng
    )
    _repair_shortfalls(np.ones(n, dtype=bool), remaining, paired, edges, rng)

    order = rng.permutation(len(edges))
    for k in order:
        i, j = edges[k]
        if rng.random() < 0.5:  # no position effect from list order
            i, j = j, i
        plan.pairs.append((int(ids[i]), int(ids[j])))
        plan.cross_unit_pairs += int(units[i] != units[j])

    counts = degree - remaining
    plan.min_comparisons = int(counts.min())
    plan.max_comparisons = int(counts.max())
    plan.unit_groups = _unit_groups(units, edges)
    if plan.units > 1 and plan.unit_groups > 1:
        plan.warnings.append(
            f"{band}: {plan.unit_groups} unit groups share no links, "
            "so their ratings sit on separate scales"
        )
    return plan


def _add_pairs(
    count: int,
    allowed: np.ndarray,
    remaining: np.ndarray,
    paired: np.ndarray,
    edges: list[tuple[int, int]],
    rng: np.random.Generator,
) -> None:
    """Add up to count pairs, always serving the officer furthest from budget."""
    n = len(remaining)
    blocked = np.zeros(n, dtype=bool)
    added = 0
    while added < count:
        noise = rng.random(n)
        pick = np.where((remaining > 0) & ~blocked, remaining + noise, -1.0)
        a = int(pick.argmax())
        if pick[a] < 0:
            return
        partners = allowed[a] & ~paired[a] & (remaining > 0)
        if not partners.any():
            blocked[a] = True  # partners only ever shrink within a pass
            continue
        b = int(np.where(partners, remaining + noise, -1.0).argmax())
        _link(a, b, remaining, paired, edges)
        added += 1


def _link(a, b, remaining, paired, edges) -> None:
    edges.append((a, b))
    paired[a, b] = paired[b, a] = True
    remaining[a] -= 1
    remaining[b] -= 1


def _repair_shortfalls(members, remaining, paired, edges, rng) -> None:
    """
    Greedy passes can strand an officer with budget left and no free partner.
    Swap an existing pair (x, y) for (a, x) and (b, y) to place them. Only
    officers in members take part, so a repair inside a unit stays inside it.
    """
    while remaining[members].sum() >= 2:
        short = np.flatnonzero(members & (remaining > 0))
        a, b = int(short[0]), int(short[-1])  # a == b if one holds both slots
        swap = _find_swap(a, b, members, paired, edges, rng)
        if swap is None:
            return  # min_comparisons reports the shortfall
        k, x, y = swap
        edges.pop(k)
        paired[x, y] = paired[y, x] = False
        remaining[x] += 1
        remaining[y] += 1
        _link(a, x, remaining, paired, edges)
        _link(b, y, remaining, paired, edges)


def _find_swap(a, b, members, paired, edges, rng):
    needed = 3 if a == b else 4
    for k in rng.permutation(len(edges)):
        first, second = edges[k]
        if not (members[first] and members[second]):
            continue
        for x, y in ((first, second), (second, first)):
            if len({a, b, x, y}) == needed and not (paired[a, x] or paired[b, y]):
                return int(k), x, y
    return None


def _unit_groups(units: np.ndarray, edges: list[tuple[int, int]]) -> int:
    """How many separate groups of units the pairs leave."""
    parent = {int(u): int(u) for u in units}

    def find(u: int) -> int:
        while parent[u] != u:
            parent[u] = parent[parent[u]]
            u = parent[u]
        return u

    for i, j in edges:
        parent[find(int(units[i]))] = find(int(units[j]))
    return len({find(u) for u in parent})
