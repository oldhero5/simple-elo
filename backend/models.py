"""
Pydantic models for ELO rating system
"""

from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class PersonnelBase(BaseModel):
    name: str
    rank: str


class PersonnelCreate(PersonnelBase):
    initial_elo: Optional[int] = 1000


class PersonnelUpdate(BaseModel):
    name: Optional[str] = None
    rank: Optional[str] = None
    active: Optional[bool] = None


class Personnel(PersonnelBase):
    id: int
    initial_elo: int
    current_elo: int
    created_at: datetime
    active: bool

    class Config:
        from_attributes = True


class RoundCreate(BaseModel):
    round_name: str
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


class RatingCreate(BaseModel):
    round_id: Optional[int] = None
    matchup_id: Optional[int] = None
    ratee_a_id: int
    ratee_b_id: int
    winner_id: Optional[int] = None  # None for draw
    rater_id: Optional[int] = None


class Rating(BaseModel):
    id: int
    round_id: int
    matchup_id: Optional[int]
    rater_id: Optional[int]
    ratee_a_id: int
    ratee_b_id: int
    winner_id: Optional[int]
    ratee_a_elo_before: int
    ratee_b_elo_before: int
    ratee_a_elo_after: int
    ratee_b_elo_after: int
    rated_at: datetime

    class Config:
        from_attributes = True


class ComparisonPair(BaseModel):
    round_info: Round
    matchup: Matchup
    person_a: Personnel
    person_b: Personnel
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
    elo_score: int


class LeaderboardEntry(BaseModel):
    personnel: Personnel
    total_ratings: int
    wins: int
    losses: int
    draws: int
    win_percentage: float
