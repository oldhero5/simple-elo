"""
Pydantic models for the Elo rating system
"""

from datetime import datetime
import unicodedata
from typing import Annotated, Literal, Optional

from pydantic import (
    AfterValidator,
    BaseModel,
    BeforeValidator,
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


# Bidirectional embeddings, overrides and isolates: they can make a name
# display as something else ("Trojan Source").
# The LRM, RLM and ALM marks steer the same way, one character at a time.
_BIDI_CONTROLS = frozenset(
    map(chr, [*range(0x202A, 0x202F), *range(0x2066, 0x206A), 0x200E, 0x200F, 0x061C])
)

# Letters and symbols that render as nothing: Hangul fillers, the Mongolian
# vowel separator and the blank Braille pattern.
_BLANK_LOOKING = frozenset(map(chr, [0x115F, 0x1160, 0x3164, 0xFFA0, 0x180E, 0x2800]))


def _visible(c: str) -> bool:
    return not (
        c.isspace()
        or c in _BLANK_LOOKING
        or unicodedata.category(c) in ("Cf", "Zs", "Mn", "Me")
    )


def _nfc(value):
    """Normalise before the length check, so the limit counts what is stored."""
    return unicodedata.normalize("NFC", value) if isinstance(value, str) else value


def _printable_text(value: str) -> str:
    """Refuse characters that break or disguise a line, and invisible text.

    Refused: control characters (Cc: NUL, tab, newline, DEL...), the line and
    paragraph separators (Zl, Zp), bidi controls and lone surrogates (Cs).
    Allowed: other format characters (Cf) that real names need, such as the
    zero-width non-joiner in Persian names, the zero-width joiner in emoji and
    the soft hyphen, and code points newer than this Python's Unicode (Cn).
    """
    for c in value:
        if unicodedata.category(c) in ("Cc", "Zl", "Zp", "Cs") or c in _BIDI_CONTROLS:
            raise ValueError(
                "must not contain control characters, line breaks or "
                "text-direction overrides"
            )
    if not any(_visible(c) for c in value):
        raise ValueError("must contain a visible character")
    return value


def _text(max_length: int):
    """Trimmed, non-empty, printable text of at most max_length characters."""
    return Annotated[
        str,
        BeforeValidator(_nfc),
        StringConstraints(strip_whitespace=True, min_length=1, max_length=max_length),
        AfterValidator(_printable_text),
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
