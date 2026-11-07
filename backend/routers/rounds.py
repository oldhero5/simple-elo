import itertools
import json
import logging
import random
from typing import Annotated

from fastapi import APIRouter, Body, Depends, HTTPException, Query, status

import queries
from db import Database, fetch_all, fetch_value, get_db, utcnow
from schemas import Round, RoundCreate, RoundDetail, RoundStatistics, RoundStatus

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/rounds", tags=["rounds"])

DB = Annotated[Database, Depends(get_db)]

_random = random.SystemRandom()


@router.get("", response_model=list[Round])
def list_rounds(
    db: DB, status_filter: RoundStatus | None = Query(None, alias="status")
) -> list[Round]:
    sql = f"SELECT {queries.ROUND_COLUMNS} FROM rounds"
    params: tuple[str, ...] = ()
    if status_filter is not None:
        sql += " WHERE status = ?"
        params = (status_filter,)
    with db.read() as conn:
        rows = fetch_all(conn, sql + " ORDER BY id DESC", params)
    return [Round(**row) for row in rows]


@router.post("", response_model=Round, status_code=status.HTTP_201_CREATED)
def create_round(
    db: DB,
    body: Annotated[RoundCreate | None, Body()] = None,
    force: bool = Query(
        False, description="End the active round first instead of returning 409."
    ),
) -> Round:
    """Start a round in which every pair of active people is compared once."""
    now = utcnow()
    with db.transaction() as conn:
        people = queries.list_personnel(conn, active_only=True)
        if len(people) < 2:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "At least 2 active people are needed to start a round",
            )
        current = queries.get_active_round(conn)
        if current is not None:
            if not force:
                raise HTTPException(
                    status.HTTP_409_CONFLICT, f"{current.name} is still in progress"
                )
            queries.close_round(conn, current.id, now)
            logger.info("Closed round %d early", current.id)

        name = body.name if body and body.name else None
        if name is None:
            name = f"Round {fetch_value(conn, 'SELECT count(*) FROM rounds') + 1}"

        # Shuffle the order and the sides so the top-rated person is not always
        # shown first or on the left.
        pairs = [
            (a, b) if _random.random() < 0.5 else (b, a)
            for a, b in itertools.combinations(people, 2)
        ]
        _random.shuffle(pairs)

        snapshot = json.dumps(
            [
                {
                    "id": p.id,
                    "name": p.name,
                    "rank": p.rank,
                    "current_elo": p.current_elo,
                }
                for p in people
            ]
        )
        round_id = fetch_value(
            conn,
            """
            INSERT INTO rounds (round_name, dtg, status, total_matchups,
                completed_matchups, personnel_snapshot, created_at)
            VALUES (?, ?, 'active', ?, 0, ?, ?)
            RETURNING id
            """,
            (name, now, len(pairs), snapshot, now),
        )
        conn.executemany(
            """
            INSERT INTO matchups
                (round_id, ratee_a_id, ratee_b_id, status, position, created_at)
            VALUES (?, ?, ?, 'pending', ?, ?)
            """,
            [
                (round_id, a.id, b.id, position, now)
                for position, (a, b) in enumerate(pairs, start=1)
            ],
        )
        new_round = queries.get_round(conn, round_id)
    logger.info(
        "Started round %d with %d people and %d matchups",
        round_id,
        len(people),
        len(pairs),
    )
    return new_round


@router.get("/{round_id}", response_model=RoundDetail)
def get_round(round_id: int, db: DB) -> RoundDetail:
    with db.read() as conn:
        round_ = queries.get_round(conn, round_id)
        if round_ is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Round not found")
        standings = queries.standings_for_rounds(conn, [round_id])[round_id]
        total_ratings = fetch_value(
            conn, "SELECT count(*) FROM ratings WHERE round_id = ?", (round_id,)
        )
    changes = [s.change for s in standings]
    return RoundDetail(
        round=round_,
        progress=queries.progress_of(round_),
        standings=standings,
        statistics=RoundStatistics(
            total_ratings=total_ratings,
            biggest_gain=max([0, *changes]),
            biggest_loss=min([0, *changes]),
            total_personnel=len(standings),
        ),
    )
