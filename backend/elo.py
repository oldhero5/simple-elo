"""Elo rating math. Pure functions, no I/O.

score_a is person A's result: 1.0 for a win, 0.0 for a loss, 0.5 for a draw.
Every change is zero-sum: whatever A gains, B loses.
"""

K_FACTOR = 32
STARTING_RATING = 1000

WIN = 1.0
DRAW = 0.5
LOSS = 0.0


def expected_score(rating_a: int, rating_b: int) -> float:
    """Probability that A beats B."""
    return 1.0 / (1.0 + 10 ** ((rating_b - rating_a) / 400))


def rating_delta(
    rating_a: int, rating_b: int, score_a: float, k_factor: int = K_FACTOR
) -> int:
    """Points A gains (negative when A loses points). B changes by the opposite."""
    if not 0.0 <= score_a <= 1.0:
        raise ValueError("score_a must be between 0 and 1")
    return round(k_factor * (score_a - expected_score(rating_a, rating_b)))


def apply_result(
    rating_a: int, rating_b: int, score_a: float, k_factor: int = K_FACTOR
) -> tuple[int, int]:
    """New ratings for A and B after a result."""
    delta = rating_delta(rating_a, rating_b, score_a, k_factor)
    return rating_a + delta, rating_b - delta


def preview(
    rating_a: int, rating_b: int, k_factor: int = K_FACTOR
) -> dict[str, tuple[int, int]]:
    """Rating changes (A, B) for each possible outcome."""
    outcomes = {"a_wins": WIN, "b_wins": LOSS, "draw": DRAW}
    result = {}
    for outcome, score_a in outcomes.items():
        delta = rating_delta(rating_a, rating_b, score_a, k_factor)
        result[outcome] = (delta, -delta)
    return result
