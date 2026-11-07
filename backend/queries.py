"""SQL shared by more than one router. Callers own the transaction."""

import json
from datetime import datetime
from typing import Any

from db import Connection, fetch_all, fetch_one, fetch_value
from schemas import Personnel, PersonRef, Progress, Rating, Round, Standing

PERSONNEL_COLUMNS = "id, name, rank, initial_elo, current_elo, created_at, active"
ROUND_COLUMNS = (
    "id, round_name AS name, dtg, status, total_matchups, completed_matchups, "
    "created_at, completed_at"
)


# Personnel


def get_person(conn: Connection, person_id: int) -> Personnel | None:
    row = fetch_one(
        conn, f"SELECT {PERSONNEL_COLUMNS} FROM personnel WHERE id = ?", (person_id,)
    )
    return Personnel(**row) if row else None


def list_personnel(conn: Connection, active_only: bool) -> list[Personnel]:
    where = "WHERE active" if active_only else ""
    rows = fetch_all(
        conn,
        f"SELECT {PERSONNEL_COLUMNS} FROM personnel {where} "
        "ORDER BY current_elo DESC, lower(name), id",
    )
    return [Personnel(**row) for row in rows]


def count_active_personnel(conn: Connection) -> int:
    return fetch_value(conn, "SELECT count(*) FROM personnel WHERE active")


def cancel_pending_for_person(conn: Connection, person_id: int, now: datetime) -> None:
    """Drop someone from the active round so it can still finish without them."""
    current = get_active_round(conn)
    if current is None:
        return
    conn.execute(
        """
        UPDATE matchups SET status = 'cancelled'
        WHERE round_id = ? AND status = 'pending'
            AND (ratee_a_id = ? OR ratee_b_id = ?)
        """,
        (current.id, person_id, person_id),
    )
    sync_round(conn, current.id, now)


# Rounds


def get_round(conn: Connection, round_id: int) -> Round | None:
    row = fetch_one(
        conn, f"SELECT {ROUND_COLUMNS} FROM rounds WHERE id = ?", (round_id,)
    )
    return Round(**row) if row else None


def get_active_round(conn: Connection) -> Round | None:
    row = fetch_one(
        conn,
        f"SELECT {ROUND_COLUMNS} FROM rounds WHERE status = 'active' "
        "ORDER BY id DESC LIMIT 1",
    )
    return Round(**row) if row else None


def progress_of(round_: Round) -> Progress:
    total = round_.total_matchups
    completed = round_.completed_matchups
    percent = round(completed / total * 100, 1) if total else 100.0
    return Progress(
        total=total, completed=completed, remaining=total - completed, percent=percent
    )


def sync_round(conn: Connection, round_id: int, now: datetime) -> bool:
    """Recount a round's matchups and complete it once nothing is pending.

    Returns True when this call is what completed the round.
    """
    counts = fetch_one(
        conn,
        """
        SELECT
            count(*) FILTER (WHERE status <> 'cancelled') AS total,
            count(*) FILTER (WHERE status = 'completed') AS completed,
            count(*) FILTER (WHERE status = 'pending') AS pending
        FROM matchups WHERE round_id = ?
        """,
        (round_id,),
    )
    status = fetch_value(conn, "SELECT status FROM rounds WHERE id = ?", (round_id,))
    finishing = status == "active" and counts["pending"] == 0
    if finishing:
        conn.execute(
            """
            UPDATE rounds SET total_matchups = ?, completed_matchups = ?,
                status = 'completed', completed_at = ?
            WHERE id = ?
            """,
            (counts["total"], counts["completed"], now, round_id),
        )
    else:
        conn.execute(
            "UPDATE rounds SET total_matchups = ?, completed_matchups = ? WHERE id = ?",
            (counts["total"], counts["completed"], round_id),
        )
    return finishing


def close_round(conn: Connection, round_id: int, now: datetime) -> None:
    """End a round early. Its unrated matchups are cancelled, not deleted."""
    conn.execute(
        "UPDATE matchups SET status = 'cancelled' "
        "WHERE round_id = ? AND status = 'pending'",
        (round_id,),
    )
    sync_round(conn, round_id, now)


def standings_for_rounds(
    conn: Connection, round_ids: list[int]
) -> dict[int, list[Standing]]:
    """Each round's starting and final rating per person, best final first.

    Starting values come from the snapshot taken when the round began; the final
    value is the person's rating after their last rating in that round.
    """
    if not round_ids:
        return {}
    placeholders = ", ".join("?" for _ in round_ids)
    snapshots = {
        row["id"]: json.loads(row["personnel_snapshot"])
        for row in fetch_all(
            conn,
            f"SELECT id, personnel_snapshot FROM rounds WHERE id IN ({placeholders})",
            round_ids,
        )
    }
    ratings = fetch_all(
        conn,
        f"""
        SELECT round_id, ratee_a_id, ratee_b_id,
            ratee_a_elo_before, ratee_a_elo_after,
            ratee_b_elo_before, ratee_b_elo_after
        FROM ratings WHERE round_id IN ({placeholders})
        ORDER BY id
        """,
        round_ids,
    )
    current_names = {
        row["id"]: (row["name"], row["rank"])
        for row in fetch_all(conn, "SELECT id, name, rank FROM personnel")
    }

    labels: dict[int, tuple[str, str]] = {}
    starting: dict[int, dict[int, int]] = {}
    final: dict[int, dict[int, int]] = {}
    for round_id, snapshot in snapshots.items():
        starting[round_id] = {}
        for person in snapshot:
            starting[round_id][person["id"]] = person["current_elo"]
            labels.setdefault(person["id"], (person["name"], person["rank"]))
        final[round_id] = dict(starting[round_id])

    for rating in ratings:
        round_id = rating["round_id"]
        sides = (
            (rating["ratee_a_id"], rating["ratee_a_elo_before"], "ratee_a_elo_after"),
            (rating["ratee_b_id"], rating["ratee_b_elo_before"], "ratee_b_elo_after"),
        )
        for person_id, before, after_key in sides:
            # Version 1 databases can hold ratings for people outside the snapshot.
            starting[round_id].setdefault(person_id, before)
            final[round_id][person_id] = rating[after_key]

    result: dict[int, list[Standing]] = {}
    for round_id in snapshots:
        standings = []
        for person_id, start in starting[round_id].items():
            name, rank = current_names.get(person_id) or labels.get(
                person_id, ("Unknown", "")
            )
            end = final[round_id][person_id]
            standings.append(
                Standing(
                    id=person_id,
                    name=name,
                    rank=rank,
                    starting_elo=start,
                    final_elo=end,
                    change=end - start,
                )
            )
        standings.sort(key=lambda s: (-s.final_elo, s.name.lower(), s.id))
        result[round_id] = standings
    return result


# Ratings

_RATING_SELECT = """
    SELECT r.id, r.round_id, r.rated_at, r.winner_id,
        r.ratee_a_id, COALESCE(pa.name, 'Unknown') AS a_name,
        COALESCE(pa.rank, '') AS a_rank,
        r.ratee_b_id, COALESCE(pb.name, 'Unknown') AS b_name,
        COALESCE(pb.rank, '') AS b_rank,
        r.ratee_a_elo_before AS a_before, r.ratee_a_elo_after AS a_after,
        r.ratee_b_elo_before AS b_before, r.ratee_b_elo_after AS b_after
    FROM ratings r
    LEFT JOIN personnel pa ON pa.id = r.ratee_a_id
    LEFT JOIN personnel pb ON pb.id = r.ratee_b_id
"""


def _rating(row: dict[str, Any]) -> Rating:
    return Rating(
        id=row["id"],
        round_id=row["round_id"],
        rated_at=row["rated_at"],
        winner_id=row["winner_id"],
        person_a=PersonRef(
            id=row["ratee_a_id"], name=row["a_name"], rank=row["a_rank"]
        ),
        person_b=PersonRef(
            id=row["ratee_b_id"], name=row["b_name"], rank=row["b_rank"]
        ),
        a_before=row["a_before"],
        a_after=row["a_after"],
        b_before=row["b_before"],
        b_after=row["b_after"],
    )


def get_rating(conn: Connection, rating_id: int) -> Rating | None:
    row = fetch_one(conn, f"{_RATING_SELECT} WHERE r.id = ?", (rating_id,))
    return _rating(row) if row else None


def recent_ratings(conn: Connection, limit: int) -> list[Rating]:
    rows = fetch_all(conn, f"{_RATING_SELECT} ORDER BY r.id DESC LIMIT ?", (limit,))
    return [_rating(row) for row in rows]
