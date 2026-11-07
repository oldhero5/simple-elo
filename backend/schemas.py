"""Request and response models for the HTTP API."""

from datetime import datetime, timezone
from typing import Annotated, Literal

from pydantic import (
    AfterValidator,
    BaseModel,
    ConfigDict,
    Field,
    PlainSerializer,
    WithJsonSchema,
)

from elo import STARTING_RATING


def _as_utc(value: datetime) -> datetime:
    # The database stores naive UTC; attach the zone so clients localize correctly.
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _iso_utc(value: datetime) -> str:
    # Millisecond precision with a Z suffix is the format every browser's Date parses.
    return value.isoformat(timespec="milliseconds").replace("+00:00", "Z")


UtcDatetime = Annotated[
    datetime,
    AfterValidator(_as_utc),
    PlainSerializer(_iso_utc, return_type=str, when_used="json"),
    WithJsonSchema({"type": "string", "format": "date-time"}),
]

Name = Annotated[str, Field(min_length=1, max_length=80)]
Rank = Annotated[str, Field(min_length=1, max_length=12)]


class Input(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)


class HealthOut(BaseModel):
    status: Literal["ok"]


# Personnel


class PersonnelCreate(Input):
    name: Name
    rank: Rank
    initial_elo: int = Field(default=STARTING_RATING, ge=100, le=3000)


class PersonnelUpdate(Input):
    name: Name | None = None
    rank: Rank | None = None
    active: bool | None = None


class Personnel(BaseModel):
    id: int
    name: str
    rank: str
    initial_elo: int
    current_elo: int
    created_at: UtcDatetime
    active: bool


class LeaderboardEntry(Personnel):
    wins: int
    losses: int
    draws: int
    matches: int


class PersonRef(BaseModel):
    id: int
    name: str
    rank: str


# Rounds

RoundStatus = Literal["active", "completed"]


class RoundCreate(Input):
    name: str | None = Field(default=None, max_length=80)


class Round(BaseModel):
    id: int
    name: str
    dtg: UtcDatetime
    status: RoundStatus
    total_matchups: int
    completed_matchups: int
    created_at: UtcDatetime
    completed_at: UtcDatetime | None


class Progress(BaseModel):
    total: int
    completed: int
    remaining: int
    percent: float


class RoundWithProgress(Round):
    progress: Progress


class Standing(BaseModel):
    id: int
    name: str
    rank: str
    starting_elo: int
    final_elo: int
    change: int


class RoundStatistics(BaseModel):
    total_ratings: int
    biggest_gain: int
    biggest_loss: int
    total_personnel: int


class RoundDetail(BaseModel):
    round: Round
    progress: Progress
    standings: list[Standing]
    statistics: RoundStatistics


# Matchups and ratings


class MatchupRef(BaseModel):
    id: int
    position: int


class Expected(BaseModel):
    a: float
    b: float


class Deltas(BaseModel):
    a: int
    b: int


class Preview(BaseModel):
    a_wins: Deltas
    b_wins: Deltas
    draw: Deltas


class NextMatchupReady(BaseModel):
    status: Literal["ready"] = "ready"
    round: Round
    progress: Progress
    matchup: MatchupRef
    person_a: Personnel
    person_b: Personnel
    expected: Expected
    preview: Preview


class NoActiveRound(BaseModel):
    status: Literal["no_active_round"] = "no_active_round"
    active_personnel: int
    last_completed_round_id: int | None


NextMatchup = Annotated[NextMatchupReady | NoActiveRound, Field(discriminator="status")]


class ResultCreate(Input):
    # Required but nullable: null records a draw, so it must be sent explicitly.
    winner_id: int | None


class Rating(BaseModel):
    id: int
    round_id: int
    rated_at: UtcDatetime
    person_a: PersonRef
    person_b: PersonRef
    winner_id: int | None
    a_before: int
    a_after: int
    b_before: int
    b_after: int


class ResultOut(BaseModel):
    rating: Rating
    round_completed: bool


class SkipOut(BaseModel):
    matchup: MatchupRef


# Reports


class Stats(BaseModel):
    total_personnel: int
    total_ratings: int
    avg_elo: float
    highest_elo: int
    lowest_elo: int
    current_round: RoundWithProgress | None
    completed_rounds: int


class RoundProgressionPoint(BaseModel):
    personnel_id: int
    name: str
    rank: str
    round_number: int
    round_name: str
    elo_score: int


class RatingProgressionPoint(BaseModel):
    sequence: int
    rating_id: int
    rated_at: UtcDatetime
    personnel_id: int
    name: str
    rank: str
    elo_score: int
