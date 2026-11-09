"""
Shuffled replay.

Sequential Elo depends on processing order, because later comparisons use partly
updated ratings. Replay runs the same comparisons in many random orders and
reports the spread. Quarters stay in sequence and order is shuffled inside each
quarter, which is how the record is scored (information paper, section 5).

Averaging makes a rating reproducible. It barely makes it more accurate.
"""

from dataclasses import dataclass
from typing import Optional

import numpy as np

from elo import K_FACTOR

DEFAULT_SHUFFLES = 100


@dataclass
class ReplayResult:
    recorded: np.ndarray  # (n,) final rating in the order recorded
    finals: np.ndarray  # (shuffles, n) final rating under each shuffled order

    @property
    def mean(self) -> np.ndarray:
        return self.finals.mean(axis=0)

    @property
    def sd(self) -> np.ndarray:
        """Spread of one officer's rating across orders."""
        return self.finals.std(axis=0, ddof=1) if len(self.finals) > 1 else (
            np.zeros(self.finals.shape[1])
        )

    @property
    def sd_of_mean(self) -> np.ndarray:
        """How far the average of this many shuffles would still move."""
        return self.sd / np.sqrt(len(self.finals))

    @property
    def rank_sd(self) -> np.ndarray:
        """Spread of one officer's position across orders."""
        ranks = (-self.finals).argsort(axis=1).argsort(axis=1)
        return ranks.std(axis=0, ddof=1) if len(self.finals) > 1 else (
            np.zeros(self.finals.shape[1])
        )


def replay_in_order(
    a: np.ndarray,
    b: np.ndarray,
    scores: np.ndarray,
    start: np.ndarray,
    k_factor: float = K_FACTOR,
) -> np.ndarray:
    """Run comparisons once, in the order given."""
    ratings = start.astype(float).copy()
    for i, j, score in zip(a.tolist(), b.tolist(), scores.tolist()):
        expected = 1 / (1 + 10 ** ((ratings[j] - ratings[i]) / 400))
        delta = k_factor * (score - expected)
        ratings[i] += delta
        ratings[j] -= delta
    return ratings


def shuffled_replay(
    a: np.ndarray,
    b: np.ndarray,
    scores: np.ndarray,
    quarters: np.ndarray,
    start: np.ndarray,
    shuffles: int = DEFAULT_SHUFFLES,
    seed: Optional[int] = None,
    k_factor: float = K_FACTOR,
) -> ReplayResult:
    """
    Replay one pool's comparisons in many orders.

    Args:
        a, b: index into start for each comparison's two officers
        scores: A's score for each comparison (1, 0.5 or 0)
        quarters: quarter of each comparison
        start: starting rating per officer
        shuffles: number of random orders
        seed: fixes the orders
    """
    rng = np.random.default_rng(seed)
    m = len(a)
    recorded = replay_in_order(a, b, scores, start, k_factor)

    # Integer quarter plus a key in [0, 1) sorts by quarter, shuffled within it.
    _, quarter_rank = np.unique(quarters, return_inverse=True)
    orders = np.argsort(quarter_rank + rng.random((shuffles, m)), axis=1).T

    ratings = np.tile(start.astype(float), (shuffles, 1))
    lanes = np.arange(shuffles)
    for step in orders:
        i, j, score = a[step], b[step], scores[step]
        rating_i, rating_j = ratings[lanes, i], ratings[lanes, j]
        expected = 1 / (1 + 10 ** ((rating_j - rating_i) / 400))
        delta = k_factor * (score - expected)
        ratings[lanes, i] = rating_i + delta
        ratings[lanes, j] = rating_j - delta
    return ReplayResult(recorded=recorded, finals=ratings)
