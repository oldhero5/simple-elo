from typing import Annotated

from fastapi import APIRouter, Depends, Query

import queries
from db import Database, fetch_all, fetch_one, fetch_value, get_db
from schemas import (
    LeaderboardEntry,
    Rating,
    RatingProgressionPoint,
    RoundProgressionPoint,
    RoundWithProgress,
    Stats,
)

router = APIRouter(prefix="/api", tags=["reports"])

DB = Annotated[Database, Depends(get_db)]


@router.get("/leaderboard", response_model=list[LeaderboardEntry])
def leaderboard(db: DB) -> list[LeaderboardEntry]:
    """Active people with their win, loss and draw counts across all rounds."""
    with db.read() as conn:
        rows = fetch_all(
            conn,
            f"""
            WITH sides AS (
                SELECT ratee_a_id AS person_id, ratee_b_id AS opponent_id, winner_id
                FROM ratings
                UNION ALL
                SELECT ratee_b_id, ratee_a_id, winner_id FROM ratings
            ),
            record AS (
                SELECT person_id,
                    count(*) FILTER (WHERE winner_id = person_id) AS wins,
                    count(*) FILTER (
                        WHERE winner_id = opponent_id AND opponent_id <> person_id
                    ) AS losses,
                    count(*) AS matches
                FROM sides GROUP BY person_id
            )
            SELECT {queries.PERSONNEL_COLUMNS},
                COALESCE(record.wins, 0) AS wins,
                COALESCE(record.losses, 0) AS losses,
                COALESCE(record.matches, 0) AS matches
            FROM personnel LEFT JOIN record ON record.person_id = personnel.id
            WHERE active
            ORDER BY current_elo DESC, lower(name), id
            """,
        )
    # Anything that is neither a win nor a loss was scored as a draw.
    return [
        LeaderboardEntry(**row, draws=row["matches"] - row["wins"] - row["losses"])
        for row in rows
    ]


@router.get("/stats", response_model=Stats)
def stats(db: DB) -> Stats:
    with db.read() as conn:
        personnel = fetch_one(
            conn,
            """
            SELECT count(*) AS total, avg(current_elo) AS avg_elo,
                max(current_elo) AS highest, min(current_elo) AS lowest
            FROM personnel WHERE active
            """,
        )
        total_ratings = fetch_value(conn, "SELECT count(*) FROM ratings")
        completed_rounds = fetch_value(
            conn, "SELECT count(*) FROM rounds WHERE status = 'completed'"
        )
        current = queries.get_active_round(conn)

    current_round = None
    if current is not None:
        current_round = RoundWithProgress(
            **current.model_dump(), progress=queries.progress_of(current)
        )
    return Stats(
        total_personnel=personnel["total"],
        total_ratings=total_ratings,
        avg_elo=round(personnel["avg_elo"] or 0, 1),
        highest_elo=personnel["highest"] or 0,
        lowest_elo=personnel["lowest"] or 0,
        current_round=current_round,
        completed_rounds=completed_rounds,
    )


@router.get("/ratings", response_model=list[Rating])
def ratings(db: DB, limit: int = Query(20, ge=1, le=200)) -> list[Rating]:
    """Most recent ratings first."""
    with db.read() as conn:
        return queries.recent_ratings(conn, limit)


@router.get("/elo-progression/by-rounds", response_model=list[RoundProgressionPoint])
def progression_by_rounds(db: DB) -> list[RoundProgressionPoint]:
    """Each active person's rating after every completed round.

    round_number 0 is each person's rating when they first took part in a
    round. Rounds that ended without any ratings are left out.
    """
    with db.read() as conn:
        rounds = fetch_all(
            conn,
            """
            SELECT id, round_name FROM rounds
            WHERE status = 'completed'
                AND EXISTS (SELECT 1 FROM ratings r WHERE r.round_id = rounds.id)
            ORDER BY dtg, id
            """,
        )
        standings = queries.standings_for_rounds(conn, [r["id"] for r in rounds])
        active_ids = {
            row["id"]
            for row in fetch_all(conn, "SELECT id FROM personnel WHERE active")
        }

    starts: list[RoundProgressionPoint] = []
    after_rounds: list[RoundProgressionPoint] = []
    started: set[int] = set()
    for number, round_ in enumerate(rounds, start=1):
        for standing in standings[round_["id"]]:
            if standing.id not in active_ids:
                continue
            if standing.id not in started:
                started.add(standing.id)
                starts.append(
                    RoundProgressionPoint(
                        personnel_id=standing.id,
                        name=standing.name,
                        rank=standing.rank,
                        round_number=0,
                        round_name="Start",
                        elo_score=standing.starting_elo,
                    )
                )
            after_rounds.append(
                RoundProgressionPoint(
                    personnel_id=standing.id,
                    name=standing.name,
                    rank=standing.rank,
                    round_number=number,
                    round_name=round_["round_name"],
                    elo_score=standing.final_elo,
                )
            )
    return starts + after_rounds


@router.get("/elo-progression/by-ratings", response_model=list[RatingProgressionPoint])
def progression_by_ratings(db: DB) -> list[RatingProgressionPoint]:
    """Each active person's rating after every rating they were part of.

    sequence counts all ratings, so it matches the order of /api/ratings.
    """
    with db.read() as conn:
        rows = fetch_all(
            conn,
            """
            WITH numbered AS (
                SELECT *, row_number() OVER (ORDER BY id) AS sequence FROM ratings
            ),
            sides AS (
                SELECT sequence, id AS rating_id, rated_at, 0 AS side,
                    ratee_a_id AS personnel_id, ratee_a_elo_after AS elo_score
                FROM numbered
                UNION ALL
                SELECT sequence, id, rated_at, 1, ratee_b_id, ratee_b_elo_after
                FROM numbered
            )
            SELECT s.sequence, s.rating_id, s.rated_at, s.personnel_id,
                p.name, p.rank, s.elo_score
            FROM sides s JOIN personnel p ON p.id = s.personnel_id
            WHERE p.active
            ORDER BY s.rating_id, s.side
            """,
        )
    return [RatingProgressionPoint(**row) for row in rows]
