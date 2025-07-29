"""
ELO Rating System Implementation
Military-grade performance rating using standard ELO algorithms
"""


def calculate_elo(
    rating_a: int, rating_b: int, result: float, k_factor: int = 32
) -> tuple[int, int]:
    """
    Calculate new ELO ratings based on match result

    Args:
        rating_a: Current ELO rating of person A
        rating_b: Current ELO rating of person B
        result: Match result (1.0 for A wins, 0.0 for B wins, 0.5 for draw)
        k_factor: Rating change sensitivity (default 32)

    Returns:
        Tuple of new ratings (new_rating_a, new_rating_b)
    """
    # Calculate expected scores
    expected_a = 1 / (1 + 10 ** ((rating_b - rating_a) / 400))
    expected_b = 1 - expected_a

    # Calculate new ratings
    new_rating_a = rating_a + k_factor * (result - expected_a)
    new_rating_b = rating_b + k_factor * ((1 - result) - expected_b)

    return int(round(new_rating_a)), int(round(new_rating_b))


def get_expected_score(rating_a: int, rating_b: int) -> tuple[float, float]:
    """
    Get expected win probability for each player

    Args:
        rating_a: ELO rating of person A
        rating_b: ELO rating of person B

    Returns:
        Tuple of expected scores (expected_a, expected_b)
    """
    expected_a = 1 / (1 + 10 ** ((rating_b - rating_a) / 400))
    expected_b = 1 - expected_a

    return expected_a, expected_b


def get_rating_change_preview(rating_a: int, rating_b: int, k_factor: int = 32) -> dict:
    """
    Preview rating changes for all possible outcomes

    Args:
        rating_a: Current ELO rating of person A
        rating_b: Current ELO rating of person B
        k_factor: Rating change sensitivity

    Returns:
        Dictionary with rating changes for each outcome
    """
    a_wins = calculate_elo(rating_a, rating_b, 1.0, k_factor)
    b_wins = calculate_elo(rating_a, rating_b, 0.0, k_factor)
    draw = calculate_elo(rating_a, rating_b, 0.5, k_factor)

    return {
        "a_wins": {
            "a_new": a_wins[0],
            "b_new": a_wins[1],
            "a_change": a_wins[0] - rating_a,
            "b_change": a_wins[1] - rating_b,
        },
        "b_wins": {
            "a_new": b_wins[0],
            "b_new": b_wins[1],
            "a_change": b_wins[0] - rating_a,
            "b_change": b_wins[1] - rating_b,
        },
        "draw": {
            "a_new": draw[0],
            "b_new": draw[1],
            "a_change": draw[0] - rating_a,
            "b_change": draw[1] - rating_b,
        },
    }
