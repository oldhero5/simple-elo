import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status

import elo
import queries
from db import Database, fetch_one, fetch_value, get_db, utcnow
from schemas import (
    Deltas,
    Expected,
    MatchupRef,
    NextMatchup,
    NextMatchupReady,
    NoActiveRound,
    Preview,
    ResultCreate,
    ResultOut,
    SkipOut,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/matchups", tags=["matchups"])

DB = Annotated[Database, Depends(get_db)]


@router.get("/next", response_model=NextMatchup)
def next_matchup(db: DB) -> NextMatchupReady | NoActiveRound:
    """The next unrated pair in the active round, or why there is none."""
    with db.read() as conn:
        current = queries.get_active_round(conn)
        matchup = None
        if current is not None:
            matchup = fetch_one(
                conn,
                """
                SELECT m.id, m.position, m.ratee_a_id, m.ratee_b_id
                FROM matchups m
                JOIN personnel a ON a.id = m.ratee_a_id AND a.active
                JOIN personnel b ON b.id = m.ratee_b_id AND b.active
                WHERE m.round_id = ? AND m.status = 'pending'
                ORDER BY m.position, m.id
                LIMIT 1
                """,
                (current.id,),
            )
        if current is None or matchup is None:
            if current is not None:
                # Writes complete a round as soon as nothing is pending, so this
                # means the data was changed outside the API.
                logger.warning("Active round %d has no rateable matchup", current.id)
            return NoActiveRound(
                active_personnel=queries.count_active_personnel(conn),
                last_completed_round_id=fetch_value(
                    conn,
                    "SELECT max(id) FROM rounds WHERE status = 'completed'",
                ),
            )
        person_a = queries.get_person(conn, matchup["ratee_a_id"])
        person_b = queries.get_person(conn, matchup["ratee_b_id"])

    expected_a = elo.expected_score(person_a.current_elo, person_b.current_elo)
    deltas = elo.preview(person_a.current_elo, person_b.current_elo)
    return NextMatchupReady(
        round=current,
        progress=queries.progress_of(current),
        matchup=MatchupRef(id=matchup["id"], position=matchup["position"]),
        person_a=person_a,
        person_b=person_b,
        expected=Expected(a=round(expected_a, 4), b=round(1 - expected_a, 4)),
        preview=Preview(
            **{
                outcome: Deltas(a=a_delta, b=b_delta)
                for outcome, (a_delta, b_delta) in deltas.items()
            }
        ),
    )


@router.post(
    "/{matchup_id}/result",
    response_model=ResultOut,
    status_code=status.HTTP_201_CREATED,
)
def submit_result(matchup_id: int, body: ResultCreate, db: DB) -> ResultOut:
    """Record who won (winner_id) or a draw (winner_id null).

    Ratings use both people's current ratings at the moment of submission.
    """
    with db.transaction() as conn:
        matchup = fetch_one(
            conn,
            """
            SELECT m.round_id, m.ratee_a_id, m.ratee_b_id, m.status,
                r.status AS round_status
            FROM matchups m JOIN rounds r ON r.id = m.round_id
            WHERE m.id = ?
            """,
            (matchup_id,),
        )
        if matchup is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Matchup not found")
        if matchup["status"] == "completed":
            raise HTTPException(
                status.HTTP_409_CONFLICT, "This matchup was already rated"
            )
        if matchup["status"] != "pending":
            raise HTTPException(status.HTTP_409_CONFLICT, "This matchup was cancelled")
        if matchup["round_status"] != "active":
            raise HTTPException(status.HTTP_409_CONFLICT, "Round is not active")

        a_id, b_id = matchup["ratee_a_id"], matchup["ratee_b_id"]
        if body.winner_id not in (None, a_id, b_id):
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_CONTENT,
                "winner_id must be one of the two people in this matchup, "
                "or null for a draw",
            )
        person_a = queries.get_person(conn, a_id)
        person_b = queries.get_person(conn, b_id)
        if not (person_a and person_b and person_a.active and person_b.active):
            raise HTTPException(
                status.HTTP_409_CONFLICT, "Both people in this matchup must be active"
            )

        if body.winner_id == a_id:
            score_a = elo.WIN
        elif body.winner_id == b_id:
            score_a = elo.LOSS
        else:
            score_a = elo.DRAW
        a_after, b_after = elo.apply_result(
            person_a.current_elo, person_b.current_elo, score_a
        )

        now = utcnow()
        rating_id = fetch_value(
            conn,
            """
            INSERT INTO ratings (round_id, matchup_id, ratee_a_id, ratee_b_id,
                winner_id, ratee_a_elo_before, ratee_b_elo_before,
                ratee_a_elo_after, ratee_b_elo_after, rated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            RETURNING id
            """,
            (
                matchup["round_id"],
                matchup_id,
                a_id,
                b_id,
                body.winner_id,
                person_a.current_elo,
                person_b.current_elo,
                a_after,
                b_after,
                now,
            ),
        )
        conn.executemany(
            "UPDATE personnel SET current_elo = ? WHERE id = ?",
            [(a_after, a_id), (b_after, b_id)],
        )
        conn.execute(
            "UPDATE matchups SET status = 'completed' WHERE id = ?", (matchup_id,)
        )
        round_completed = queries.sync_round(conn, matchup["round_id"], now)
        rating = queries.get_rating(conn, rating_id)

    if round_completed:
        logger.info("Round %d completed", matchup["round_id"])
    return ResultOut(rating=rating, round_completed=round_completed)


@router.post("/{matchup_id}/skip", response_model=SkipOut)
def skip_matchup(matchup_id: int, db: DB) -> SkipOut:
    """Move a pending matchup to the end of its round's queue."""
    with db.transaction() as conn:
        matchup = fetch_one(
            conn, "SELECT round_id, status FROM matchups WHERE id = ?", (matchup_id,)
        )
        if matchup is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Matchup not found")
        if matchup["status"] != "pending":
            raise HTTPException(
                status.HTTP_409_CONFLICT, "Only an unrated matchup can be skipped"
            )
        position = (
            fetch_value(
                conn,
                "SELECT max(position) FROM matchups WHERE round_id = ?",
                (matchup["round_id"],),
            )
            + 1
        )
        conn.execute(
            "UPDATE matchups SET position = ? WHERE id = ?", (position, matchup_id)
        )
    return SkipOut(matchup=MatchupRef(id=matchup_id, position=position))
