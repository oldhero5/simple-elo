"""
Elo rating arithmetic.

Ratings are kept unrounded. Rounding after every match compounds, and shuffled
replay cannot reproduce the record if the stored values have been rounded.
Round only for display.
"""

from typing import Optional

K_FACTOR = 32
START_RATING = 1000

A_WINS = "a_wins"
B_WINS = "b_wins"
DRAW = "draw"
CANT_JUDGE = "cant_judge"

# A can't-judge answer is a recorded non-judgment, not a score of any kind.
_SCORE_FOR_A = {A_WINS: 1.0, B_WINS: 0.0, DRAW: 0.5, CANT_JUDGE: None}


def score_for_outcome(outcome: str) -> Optional[float]:
    """Person A's score for an outcome, or None if it carries no score."""
    return _SCORE_FOR_A[outcome]


def calculate_elo(
    rating_a: float, rating_b: float, result: float, k_factor: float = K_FACTOR
) -> tuple[float, float]:
    """
    Calculate new ratings from a match result.

    Args:
        rating_a: Current rating of person A
        rating_b: Current rating of person B
        result: 1.0 for A wins, 0.0 for B wins, 0.5 for draw
        k_factor: Rating change sensitivity

    Returns:
        Tuple of unrounded new ratings (new_rating_a, new_rating_b)
    """
    expected_a, expected_b = get_expected_score(rating_a, rating_b)
    new_rating_a = rating_a + k_factor * (result - expected_a)
    new_rating_b = rating_b + k_factor * ((1 - result) - expected_b)
    return new_rating_a, new_rating_b


def apply_outcome(
    rating_a: float, rating_b: float, outcome: str, k_factor: float = K_FACTOR
) -> tuple[float, float]:
    """Apply an outcome. A can't-judge leaves both ratings exactly as they were."""
    score = score_for_outcome(outcome)
    if score is None:
        return rating_a, rating_b
    return calculate_elo(rating_a, rating_b, score, k_factor)


def get_expected_score(rating_a: float, rating_b: float) -> tuple[float, float]:
    """Expected score for each person."""
    expected_a = 1 / (1 + 10 ** ((rating_b - rating_a) / 400))
    return expected_a, 1 - expected_a


def get_rating_change_preview(
    rating_a: float, rating_b: float, k_factor: float = K_FACTOR
) -> dict:
    """Preview the rating change for every possible answer."""
    preview = {}
    for outcome in (A_WINS, B_WINS, DRAW, CANT_JUDGE):
        new_a, new_b = apply_outcome(rating_a, rating_b, outcome, k_factor)
        key = {A_WINS: "a_wins", B_WINS: "b_wins"}.get(outcome, outcome)
        preview[key] = {
            "a_new": new_a,
            "b_new": new_b,
            "a_change": new_a - rating_a,
            "b_change": new_b - rating_b,
        }
    return preview
