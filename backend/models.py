"""
Pydantic models for the Elo rating system
"""

from datetime import datetime
import unicodedata
from typing import Annotated, Literal, Optional

from pydantic import (
    AfterValidator,
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    model_validator,
)

Track = Literal["performance", "potential"]
Band = Literal["tactical", "operational", "strategic", "unbanded"]
Outcome = Literal["a_wins", "b_wins", "draw", "cant_judge"]

UNASSIGNED = "UNASSIGNED"

# A quarter number past this is a typo, not a hundred years of records.
MAX_QUARTER = 400

# numpy seeds are unsigned; keep them in the range every generator accepts.
MAX_SEED = 2**32 - 1


def _no_control_characters(value: str) -> str:
    if any(unicodedata.category(c).startswith("C") for c in value):
        raise ValueError("must not contain control characters")
    return value


def _text(max_length: int):
    """Trimmed, non-empty, printable text of at most max_length characters."""
    return Annotated[
        str,
        StringConstraints(strip_whitespace=True, min_length=1, max_length=max_length),
        AfterValidator(_no_control_characters),
    ]


Name = _text(100)
Rank = _text(10)
Unit = _text(50)
RoundName = _text(120)


class Input(BaseModel):
    """Base for request bodies: NaN and infinity are not numbers here."""

    model_config = ConfigDict(allow_inf_nan=False)


class PersonnelBase(BaseModel):
    name: str
    rank: str
    unit: str = UNASSIGNED


class PersonnelCreate(Input):
    name: Name
    rank: Rank
    unit: Unit = UNASSIGNED
    initial_elo: int = Field(default=1000, ge=0, le=5000)


class PersonnelUpdate(Input):
    name: Optional[Name] = None
    rank: Optional[Rank] = None
    unit: Optional[Unit] = None
    active: Optional[bool] = None


class Personnel(PersonnelBase):
    id: int
    band: str
    initial_elo: int
    current_elo: float  # performance track
    current_potential: float  # potential track
    created_at: datetime
    active: bool
    synthetic: bool = False

    class Config:
        from_attributes = True


class RoundConfig(Input):
    """How a round's pairs are chosen. Defaults follow the information paper."""

    track: Track = "performance"
    comparisons_per_officer: int = Field(default=10, ge=1, le=29)
    cross_unit_share: float = Field(default=0.2, ge=0, le=1)
    quarter: Optional[int] = Field(default=None, ge=1, le=MAX_QUARTER)
    band: Optional[Band] = None
    seed: Optional[int] = Field(default=None, ge=0, le=MAX_SEED)


class RoundCreate(RoundConfig):
    round_name: RoundName
    dtg: Optional[datetime] = None


class Round(BaseModel):
    id: int
    round_name: str
    dtg: datetime
    status: str
    total_matchups: int
    completed_matchups: int
    personnel_snapshot: str
    created_at: datetime
    track: Track
    quarter: int
    comparisons_per_officer: Optional[int]
    cross_unit_share: Optional[float]
    band: Optional[str]
    design: dict

    class Config:
        from_attributes = True


class Matchup(BaseModel):
    id: int
    round_id: int
    ratee_a_id: int
    ratee_b_id: int
    status: str
    created_at: datetime

    class Config:
        from_attributes = True


class RatingCreate(Input):
    round_id: Optional[int] = None
    matchup_id: Optional[int] = None
    ratee_a_id: int
    ratee_b_id: int
    winner_id: Optional[int] = None  # None is a draw unless cant_judge is set
    cant_judge: bool = False
    rater_id: Optional[int] = None

    @model_validator(mode="after")
    def cant_judge_names_no_winner(self):
        if self.cant_judge and self.winner_id is not None:
            raise ValueError("A can't-judge answer cannot name a winner")
        return self


class Rating(BaseModel):
    id: int
    round_id: int
    matchup_id: Optional[int]
    rater_id: Optional[int]
    ratee_a_id: int
    ratee_b_id: int
    winner_id: Optional[int]
    ratee_a_elo_before: float
    ratee_b_elo_before: float
    ratee_a_elo_after: float
    ratee_b_elo_after: float
    rated_at: datetime
    track: Track
    quarter: int
    band: Optional[str]
    unit_a: str
    unit_b: str
    cross_unit: bool
    outcome: Outcome

    class Config:
        from_attributes = True


class ComparisonPair(BaseModel):
    round_info: Round
    matchup: Matchup
    person_a: Personnel
    person_b: Personnel
    track: Track
    question: str
    rating_a: float
    rating_b: float
    cross_unit: bool
    expected_scores: dict
    rating_preview: dict
    progress: dict  # Round progress information


class LegacyComparisonPair(BaseModel):
    person_a: Personnel
    person_b: Personnel
    expected_scores: dict
    rating_preview: dict


class EloHistoryPoint(BaseModel):
    personnel_id: int
    name: str
    rank: str
    rated_at: datetime
    elo_score: float
