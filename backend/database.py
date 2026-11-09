"""
DuckDB database connection and operations
"""

import json
import os
from datetime import datetime
from pathlib import Path
from typing import List, Optional

import duckdb

from bands import band_for_rank
from elo import A_WINS, B_WINS, CANT_JUDGE, DRAW, apply_outcome
from errors import RatingError
from models import (
    EloHistoryPoint,
    Matchup,
    Personnel,
    PersonnelCreate,
    PersonnelUpdate,
    Rating,
    Round,
    RoundConfig,
    RoundCreate,
)
from pairing import select_pairs

DEFAULT_DB_PATH = Path(__file__).resolve().parent.parent / "data" / "elo_ratings.db"

RATING_COLUMN = {"performance": "current_elo", "potential": "current_potential"}

QUESTIONS = {
    "performance": "Who showed the stronger performance in what you saw?",
    "potential": "Who has the greater potential to serve at the next level?",
}

# Every optional column read with its default. The migration fills NULLs on
# start, but a NULL written while running (by hand, or by an older build) must
# not break every roster, stats and round read until the next restart.
PERSONNEL_DEFAULTS = {
    "unit": "'UNASSIGNED'",
    "band": "'unbanded'",
    "initial_elo": "1000",
    "current_elo": "coalesce(initial_elo, 1000)",
    "current_potential": "coalesce(initial_elo, 1000)",
    "created_at": "TIMESTAMP '1970-01-01 00:00:00'",
    "active": "TRUE",
    "synthetic": "FALSE",
}

ACTIVE = "coalesce(active, TRUE)"


def _with_default(column: str) -> str:
    return f"coalesce({column}, {PERSONNEL_DEFAULTS[column]})"


PERSONNEL_COLUMNS = "id, name, rank, " + ", ".join(
    f"{_with_default(c)} AS {c}"
    for c in (
        "unit",
        "band",
        "initial_elo",
        "current_elo",
        "current_potential",
        "created_at",
        "active",
        "synthetic",
    )
)

SCHEMA = """
CREATE SEQUENCE IF NOT EXISTS personnel_id_seq START 1;
CREATE TABLE IF NOT EXISTS personnel (
    id INTEGER PRIMARY KEY DEFAULT nextval('personnel_id_seq'),
    name VARCHAR NOT NULL,
    rank VARCHAR NOT NULL,
    initial_elo INTEGER DEFAULT 1000,
    current_elo DOUBLE DEFAULT 1000,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    active BOOLEAN DEFAULT TRUE
);
CREATE SEQUENCE IF NOT EXISTS rounds_id_seq START 1;
CREATE TABLE IF NOT EXISTS rounds (
    id INTEGER PRIMARY KEY DEFAULT nextval('rounds_id_seq'),
    round_name VARCHAR NOT NULL,
    dtg TIMESTAMP NOT NULL,
    status VARCHAR DEFAULT 'active',
    total_matchups INTEGER NOT NULL,
    completed_matchups INTEGER DEFAULT 0,
    personnel_snapshot TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE SEQUENCE IF NOT EXISTS matchups_id_seq START 1;
CREATE TABLE IF NOT EXISTS matchups (
    id INTEGER PRIMARY KEY DEFAULT nextval('matchups_id_seq'),
    round_id INTEGER NOT NULL,
    ratee_a_id INTEGER NOT NULL,
    ratee_b_id INTEGER NOT NULL,
    status VARCHAR DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(round_id, ratee_a_id, ratee_b_id)
);
CREATE SEQUENCE IF NOT EXISTS ratings_id_seq START 1;
CREATE TABLE IF NOT EXISTS ratings (
    id INTEGER PRIMARY KEY DEFAULT nextval('ratings_id_seq'),
    round_id INTEGER NOT NULL,
    matchup_id INTEGER,
    rater_id INTEGER,
    ratee_a_id INTEGER NOT NULL,
    ratee_b_id INTEGER NOT NULL,
    winner_id INTEGER,
    ratee_a_elo_before DOUBLE NOT NULL,
    ratee_b_elo_before DOUBLE NOT NULL,
    ratee_a_elo_after DOUBLE NOT NULL,
    ratee_b_elo_after DOUBLE NOT NULL,
    rated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS dataset_meta (
    key VARCHAR PRIMARY KEY,
    value VARCHAR NOT NULL
);
"""

# Added to the original tables. Applied to new and existing databases alike.
ADDED_COLUMNS = [
    ("personnel", "band", "VARCHAR"),
    ("personnel", "unit", "VARCHAR DEFAULT 'UNASSIGNED'"),
    ("personnel", "current_potential", "DOUBLE DEFAULT 1000"),
    ("personnel", "synthetic", "BOOLEAN DEFAULT FALSE"),
    ("rounds", "track", "VARCHAR DEFAULT 'performance'"),
    ("rounds", "quarter", "INTEGER DEFAULT 1"),
    ("rounds", "comparisons_per_officer", "INTEGER"),
    ("rounds", "cross_unit_share", "DOUBLE"),
    ("rounds", "band", "VARCHAR"),
    ("rounds", "design", "VARCHAR DEFAULT '{}'"),
    ("ratings", "track", "VARCHAR DEFAULT 'performance'"),
    ("ratings", "quarter", "INTEGER DEFAULT 1"),
    ("ratings", "band", "VARCHAR"),
    ("ratings", "unit_a", "VARCHAR DEFAULT 'UNASSIGNED'"),
    ("ratings", "unit_b", "VARCHAR DEFAULT 'UNASSIGNED'"),
    ("ratings", "cross_unit", "BOOLEAN DEFAULT FALSE"),
    ("ratings", "outcome", "VARCHAR"),
]

# Integer in the original schema. Rounding every update is the bug being removed.
WIDENED_COLUMNS = [
    ("personnel", "current_elo"),
    ("ratings", "ratee_a_elo_before"),
    ("ratings", "ratee_b_elo_before"),
    ("ratings", "ratee_a_elo_after"),
    ("ratings", "ratee_b_elo_after"),
]


def dict_rows(cursor) -> List[dict]:
    columns = [c[0] for c in cursor.description]
    return [dict(zip(columns, row)) for row in cursor.fetchall()]


def _round(row: dict) -> Round:
    return Round(**{**row, "design": json.loads(row["design"] or "{}")})


class Database:
    def __init__(self, db_path: Optional[str] = None):
        self.db_path = str(db_path or os.getenv("DATABASE_URL") or DEFAULT_DB_PATH)
        os.makedirs(os.path.dirname(self.db_path), exist_ok=True)
        self.init_database()

    def get_connection(self):
        return duckdb.connect(self.db_path)

    def init_database(self):
        """Create tables and bring an older database up to the current schema."""
        with self.get_connection() as conn:
            conn.execute(SCHEMA)
            self._migrate(conn)
            # Fold the schema changes into the file now. DuckDB 1.x cannot
            # replay an ALTER TABLE on these tables from the write-ahead log,
            # so a kill before the next checkpoint (a crash, power loss, any
            # request still holding a connection) would leave a file that no
            # longer opens. Later writes are plain DML, which replays fine.
            conn.execute("CHECKPOINT")

    def _migrate(self, conn):
        for table, column, ddl in ADDED_COLUMNS:
            conn.execute(f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS {column} {ddl}")

        for table, column in WIDENED_COLUMNS:
            info = conn.execute(f"PRAGMA table_info('{table}')").fetchall()
            if next(c[2] for c in info if c[1] == column) != "DOUBLE":
                conn.execute(f"ALTER TABLE {table} ALTER {column} TYPE DOUBLE")

        # These columns allow NULL and the API once let a null initial_elo
        # through. Reads tolerate NULLs (PERSONNEL_COLUMNS); store the defaults
        # too. initial_elo first: the ratings fall back to it.
        for column in (
            "initial_elo",
            "current_elo",
            "current_potential",
            "unit",
            "created_at",
            "active",
            "synthetic",
        ):
            conn.execute(
                f"UPDATE personnel SET {column} = {PERSONNEL_DEFAULTS[column]} "
                f"WHERE {column} IS NULL"
            )

        unbanded = conn.execute(
            "SELECT DISTINCT rank FROM personnel WHERE band IS NULL"
        ).fetchall()
        for (rank,) in unbanded:
            conn.execute(
                "UPDATE personnel SET band = ? WHERE rank = ? AND band IS NULL",
                (band_for_rank(rank), rank),
            )

        # Rows from before outcomes existed: a NULL winner was always a draw.
        conn.execute(
            f"""
            UPDATE ratings SET outcome = CASE
                WHEN winner_id = ratee_a_id THEN '{A_WINS}'
                WHEN winner_id = ratee_b_id THEN '{B_WINS}'
                ELSE '{DRAW}' END
            WHERE outcome IS NULL
            """
        )
        conn.execute(
            """
            UPDATE ratings SET band = p.band FROM personnel p
            WHERE ratings.ratee_a_id = p.id AND ratings.band IS NULL
            """
        )

    # Dataset labelling
    def get_meta(self) -> dict:
        with self.get_connection() as conn:
            rows = dict(conn.execute("SELECT key, value FROM dataset_meta").fetchall())
        return {
            "synthetic": rows.get("synthetic") == "true",
            "label": rows.get("label"),
            "source": rows.get("source"),
            "notes": json.loads(rows.get("notes", "[]")),
        }

    # Personnel operations
    def create_personnel(self, personnel_data: PersonnelCreate) -> Personnel:
        """Create new personnel entry"""
        with self.get_connection() as conn:
            cursor = conn.execute(
                f"""
                INSERT INTO personnel
                    (name, rank, unit, band, initial_elo, current_elo,
                     current_potential)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                RETURNING {PERSONNEL_COLUMNS}
                """,
                (
                    personnel_data.name,
                    personnel_data.rank,
                    personnel_data.unit,
                    band_for_rank(personnel_data.rank),
                    personnel_data.initial_elo,
                    personnel_data.initial_elo,
                    personnel_data.initial_elo,
                ),
            )
            return Personnel(**dict_rows(cursor)[0])

    def get_personnel(self, personnel_id: int) -> Optional[Personnel]:
        """Get active personnel by ID"""
        with self.get_connection() as conn:
            rows = dict_rows(
                conn.execute(
                    f"""
                    SELECT {PERSONNEL_COLUMNS} FROM personnel
                    WHERE id = ? AND {ACTIVE}
                    """,
                    (personnel_id,),
                )
            )
        return Personnel(**rows[0]) if rows else None

    def get_all_personnel(
        self,
        active_only: bool = True,
        band: Optional[str] = None,
        unit: Optional[str] = None,
        limit: Optional[int] = None,
    ) -> List[Personnel]:
        """Get personnel, highest performance rating first"""
        where, params = [], []
        if active_only:
            where.append(ACTIVE)
        if band:
            where.append("band = ?")
            params.append(band)
        if unit:
            where.append("unit = ?")
            params.append(unit)
        query = f"SELECT {PERSONNEL_COLUMNS} FROM personnel"
        if where:
            query += " WHERE " + " AND ".join(where)
        query += " ORDER BY current_elo DESC, id"
        if limit:
            query += " LIMIT ?"
            params.append(limit)
        with self.get_connection() as conn:
            return [Personnel(**r) for r in dict_rows(conn.execute(query, params))]

    def update_personnel(
        self, personnel_id: int, personnel_data: PersonnelUpdate
    ) -> Optional[Personnel]:
        """
        Update personnel information.

        A rank change that crosses a band restarts both ratings at the officer's
        initial rating, because a rating only means something inside its band.
        The earlier record stays in place under the old band.
        """
        with self.get_connection() as conn:
            existing = dict_rows(
                conn.execute(
                    f"SELECT {PERSONNEL_COLUMNS} FROM personnel WHERE id = ?",
                    (personnel_id,),
                )
            )
            if not existing:
                return None
            person = existing[0]

            updates, values = [], []
            for column in ("name", "rank", "unit", "active"):
                value = getattr(personnel_data, column)
                if value is not None:
                    updates.append(f"{column} = ?")
                    values.append(value)

            if personnel_data.rank is not None:
                new_band = band_for_rank(personnel_data.rank)
                if new_band != person["band"]:
                    updates += ["band = ?", "current_elo = ?", "current_potential = ?"]
                    values += [new_band, person["initial_elo"], person["initial_elo"]]

            if not updates:
                return Personnel(**person)

            values.append(personnel_id)
            # UPDATE then SELECT rather than UPDATE ... RETURNING, which raised a
            # false duplicate-key error on DuckDB 0.9. Harmless on 1.x.
            conn.execute(
                f"UPDATE personnel SET {', '.join(updates)} WHERE id = ?", values
            )
            cursor = conn.execute(
                f"SELECT {PERSONNEL_COLUMNS} FROM personnel WHERE id = ?",
                (personnel_id,),
            )
            return Personnel(**dict_rows(cursor)[0])

    # Record queries
    def count_scored_ratings(self) -> int:
        with self.get_connection() as conn:
            return conn.execute(
                "SELECT count(*) FROM ratings WHERE outcome <> ?", (CANT_JUDGE,)
            ).fetchone()[0]

    def get_rating_history(self, limit: int = 100) -> List[Rating]:
        """Get recent rating history, can't-judge answers included"""
        with self.get_connection() as conn:
            rows = dict_rows(
                conn.execute("SELECT * FROM ratings ORDER BY id DESC LIMIT ?", (limit,))
            )
        return [Rating(**r) for r in rows]

    def get_elo_progression(
        self, track: str = "performance"
    ) -> List[EloHistoryPoint]:
        """Get rating progression data for charting"""
        with self.get_connection() as conn:
            rows = dict_rows(
                conn.execute(
                    """
                    SELECT
                        p.id AS personnel_id,
                        p.name,
                        p.rank,
                        r.rated_at,
                        CASE WHEN p.id = r.ratee_a_id THEN r.ratee_a_elo_after
                             ELSE r.ratee_b_elo_after END AS elo_score
                    FROM personnel p
                    JOIN ratings r ON p.id = r.ratee_a_id OR p.id = r.ratee_b_id
                    WHERE coalesce(p.active, TRUE) AND r.track = ? AND r.outcome <> ?
                    ORDER BY r.id
                    """,
                    (track, CANT_JUDGE),
                )
            )
        return [EloHistoryPoint(**r) for r in rows]

    def get_elo_progression_by_rounds(self, track: str = "performance") -> List[dict]:
        """Get rating progression data grouped by completed rounds"""
        with self.get_connection() as conn:
            completed = dict_rows(
                conn.execute(
                    """
                    SELECT id, round_name, dtg, personnel_snapshot FROM rounds
                    WHERE status = 'completed' AND track = ?
                    ORDER BY dtg
                    """,
                    (track,),
                )
            )
        if not completed:
            return []

        progression = [
            {
                "personnel_id": person["id"],
                "name": person["name"],
                "rank": person["rank"],
                "round_name": "Starting ELO",
                "round_number": 0,
                "elo_score": person["current_elo"],
                "round_dtg": completed[0]["dtg"],
            }
            for person in json.loads(completed[0]["personnel_snapshot"])
        ]
        for number, round_row in enumerate(completed, start=1):
            results = self.get_round_results(round_row["id"])
            for person in results.get("leaderboard", []):
                progression.append(
                    {
                        "personnel_id": person["id"],
                        "name": person["name"],
                        "rank": person["rank"],
                        "round_name": round_row["round_name"],
                        "round_number": number,
                        "elo_score": person["final_elo"],
                        "round_dtg": round_row["dtg"],
                    }
                )
        return progression

    # Round management
    def next_quarter(self, track: str) -> int:
        """One pass per track per quarter: the quarter after this track's latest."""
        with self.get_connection() as conn:
            latest = conn.execute(
                "SELECT max(quarter) FROM rounds WHERE track = ?", (track,)
            ).fetchone()[0]
        return (latest or 0) + 1

    def create_round(self, round_data: RoundCreate) -> Round:
        """Create a round with budgeted matchups"""
        people = self.get_all_personnel(active_only=True, band=round_data.band)
        if len(people) < 2:
            raise RatingError("Need at least 2 active personnel to create a round")

        plans = select_pairs(
            [(p.id, p.band, p.unit) for p in people],
            round_data.comparisons_per_officer,
            round_data.cross_unit_share,
            round_data.seed,
        )
        pairs = [pair for plan in plans for pair in plan.pairs]
        if not pairs:
            raise RatingError("No band has 2 active personnel to compare")

        rating = RATING_COLUMN[round_data.track]
        snapshot = json.dumps(
            [
                {
                    "id": p.id,
                    "name": p.name,
                    "rank": p.rank,
                    "band": p.band,
                    "unit": p.unit,
                    "current_elo": getattr(p, rating),
                }
                for p in people
            ]
        )
        design = {
            "seed": round_data.seed,
            "bands": [plan.summary() for plan in plans],
            "warnings": [w for plan in plans for w in plan.warnings],
        }
        quarter = round_data.quarter or self.next_quarter(round_data.track)

        with self.get_connection() as conn:
            conn.execute("BEGIN TRANSACTION")
            cursor = conn.execute(
                """
                INSERT INTO rounds (round_name, dtg, total_matchups, personnel_snapshot,
                                    track, quarter, comparisons_per_officer,
                                    cross_unit_share, band, design)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                RETURNING *
                """,
                (
                    round_data.round_name,
                    round_data.dtg or datetime.now(),
                    len(pairs),
                    snapshot,
                    round_data.track,
                    quarter,
                    round_data.comparisons_per_officer,
                    round_data.cross_unit_share,
                    round_data.band,
                    json.dumps(design),
                ),
            )
            round_obj = _round(dict_rows(cursor)[0])
            for start in range(0, len(pairs), 500):
                chunk = pairs[start : start + 500]
                conn.execute(
                    "INSERT INTO matchups (round_id, ratee_a_id, ratee_b_id) VALUES "
                    + ", ".join(["(?, ?, ?)"] * len(chunk)),
                    [x for a, b in chunk for x in (round_obj.id, a, b)],
                )
            conn.execute("COMMIT")
        return round_obj

    def get_current_round(self) -> Optional[Round]:
        """Get the current active round"""
        with self.get_connection() as conn:
            rows = dict_rows(
                conn.execute(
                    """
                    SELECT * FROM rounds WHERE status = 'active'
                    ORDER BY created_at DESC, id DESC LIMIT 1
                    """
                )
            )
        return _round(rows[0]) if rows else None

    def complete_round(self, round_id: int):
        with self.get_connection() as conn:
            conn.execute(
                "UPDATE rounds SET status = 'completed' WHERE id = ?", (round_id,)
            )

    def get_next_matchup(self, round_id: int) -> Optional[Matchup]:
        """Get the next pending matchup for a round"""
        with self.get_connection() as conn:
            rows = dict_rows(
                conn.execute(
                    """
                    SELECT id, round_id, ratee_a_id, ratee_b_id, status, created_at
                    FROM matchups WHERE round_id = ? AND status = 'pending'
                    ORDER BY id LIMIT 1
                    """,
                    (round_id,),
                )
            )
        return Matchup(**rows[0]) if rows else None

    def _close_matchup(self, conn, matchup_id: int, round_id: int, status: str):
        """Take a matchup out of the queue and finish the round if it was the last."""
        conn.execute(
            "UPDATE matchups SET status = ? WHERE id = ?", (status, matchup_id)
        )
        if status == "void":
            conn.execute(
                "UPDATE rounds SET total_matchups = total_matchups - 1 WHERE id = ?",
                (round_id,),
            )
        else:
            conn.execute(
                """
                UPDATE rounds SET completed_matchups = completed_matchups + 1
                WHERE id = ?
                """,
                (round_id,),
            )
        conn.execute(
            """
            UPDATE rounds SET status = 'completed'
            WHERE id = ? AND completed_matchups >= total_matchups
            """,
            (round_id,),
        )

    def get_round_progress(self, round_id: int) -> dict:
        """Get progress information for a round"""
        with self.get_connection() as conn:
            result = conn.execute(
                """
                SELECT total_matchups, completed_matchups, status FROM rounds
                WHERE id = ?
                """,
                (round_id,),
            ).fetchone()
            if not result:
                return {}
            cant_judge = conn.execute(
                "SELECT count(*) FROM ratings WHERE round_id = ? AND outcome = ?",
                (round_id, CANT_JUDGE),
            ).fetchone()[0]

        total, completed, status = result
        return {
            "total_matchups": total,
            "completed_matchups": completed,
            "remaining_matchups": total - completed,
            "completion_percentage": (completed / total * 100) if total > 0 else 0,
            "cant_judge": cant_judge,
            "status": status,
        }

    def get_round_based_comparison_pair(self):
        """Get next comparison pair from the current round"""
        current_round = self.get_current_round()
        if not current_round:
            return None

        while True:
            next_matchup = self.get_next_matchup(current_round.id)
            if not next_matchup:
                return None

            person_a = self.get_personnel(next_matchup.ratee_a_id)
            person_b = self.get_personnel(next_matchup.ratee_b_id)
            if person_a and person_b and person_a.band == person_b.band:
                break

            # Someone left the pool or changed band after the round was planned.
            with self.get_connection() as conn:
                self._close_matchup(conn, next_matchup.id, current_round.id, "void")

        column = RATING_COLUMN[current_round.track]
        return {
            # The snapshot is large and nothing in a comparison reads it.
            "round_info": current_round.model_copy(update={"personnel_snapshot": ""}),
            "matchup": next_matchup,
            "person_a": person_a,
            "person_b": person_b,
            "track": current_round.track,
            "question": QUESTIONS[current_round.track],
            "rating_a": getattr(person_a, column),
            "rating_b": getattr(person_b, column),
            "cross_unit": person_a.unit != person_b.unit,
            "progress": self.get_round_progress(current_round.id),
        }

    def create_initial_round_if_needed(self):
        """Create first round only when explicitly called"""
        current_round = self.get_current_round()
        if current_round:
            return current_round
        if len(self.get_all_personnel(active_only=True)) < 2:
            return None
        return self.create_round(
            RoundCreate(round_name=f"Round 1 - {datetime.now():%Y%m%d-%H%M%S}")
        )

    def start_new_round(self, config: RoundConfig) -> Round:
        """Close any active round and open a new one"""
        current_round = self.get_current_round()
        if current_round:
            self.complete_round(current_round.id)
        number = len(self.get_completed_rounds()) + 1
        return self.create_round(
            RoundCreate(
                round_name=f"Round {number} - {datetime.now():%Y%m%d-%H%M%S}",
                **config.model_dump(),
            )
        )

    def create_round_rating(
        self,
        round_id: int,
        matchup_id: int,
        winner_id: Optional[int],
        cant_judge: bool = False,
        rater_id: Optional[int] = None,
    ) -> Rating:
        """
        Record one answer to a pending matchup, in one transaction.

        The matchup decides who was compared. A can't-judge answer is kept in the
        record and closes the matchup, but moves no rating.
        """
        with self.get_connection() as conn:
            conn.execute("BEGIN TRANSACTION")
            matchup = conn.execute(
                """
                SELECT m.ratee_a_id, m.ratee_b_id, m.status, r.track, r.quarter, r.dtg
                FROM matchups m JOIN rounds r ON m.round_id = r.id
                WHERE m.id = ? AND m.round_id = ?
                """,
                (matchup_id, round_id),
            ).fetchone()
            if not matchup:
                raise RatingError("Matchup not found in this round")
            a_id, b_id, status, track, quarter, dtg = matchup
            if status != "pending":
                raise RatingError("Matchup has already been answered")

            column = RATING_COLUMN[track]
            people = dict_rows(
                conn.execute(
                    f"""
                    SELECT id, {_with_default("band")} AS band,
                           {_with_default("unit")} AS unit,
                           {_with_default(column)} AS rating
                    FROM personnel WHERE id IN (?, ?) AND {ACTIVE}
                    """,
                    (a_id, b_id),
                )
            )
            by_id = {p["id"]: p for p in people}
            if len(by_id) != 2:
                raise RatingError("Personnel not found")
            person_a, person_b = by_id[a_id], by_id[b_id]
            if person_a["band"] != person_b["band"]:
                raise RatingError("Ratings are kept within band")

            if cant_judge:
                outcome = CANT_JUDGE
            elif winner_id is None:
                outcome = DRAW
            elif winner_id == a_id:
                outcome = A_WINS
            elif winner_id == b_id:
                outcome = B_WINS
            else:
                raise RatingError("Winner is not in this matchup")

            new_a, new_b = apply_outcome(
                person_a["rating"], person_b["rating"], outcome
            )
            cursor = conn.execute(
                """
                INSERT INTO ratings (round_id, matchup_id, rater_id, ratee_a_id,
                                     ratee_b_id, winner_id, ratee_a_elo_before,
                                     ratee_b_elo_before, ratee_a_elo_after,
                                     ratee_b_elo_after, rated_at, track, quarter, band,
                                     unit_a, unit_b, cross_unit, outcome)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                RETURNING *
                """,
                (
                    round_id,
                    matchup_id,
                    rater_id,
                    a_id,
                    b_id,
                    winner_id,
                    person_a["rating"],
                    person_b["rating"],
                    new_a,
                    new_b,
                    dtg,
                    track,
                    quarter,
                    person_a["band"],
                    person_a["unit"],
                    person_b["unit"],
                    person_a["unit"] != person_b["unit"],
                    outcome,
                ),
            )
            rating = Rating(**dict_rows(cursor)[0])

            if not cant_judge:
                for person_id, value in ((a_id, new_a), (b_id, new_b)):
                    conn.execute(
                        f"UPDATE personnel SET {column} = ? WHERE id = ?",
                        (value, person_id),
                    )

            self._close_matchup(
                conn,
                matchup_id,
                round_id,
                "cant_judge" if cant_judge else "completed",
            )
            conn.execute("COMMIT")
            return rating

    def get_completed_rounds(self, limit: int = 100) -> List[Round]:
        """Get completed rounds, newest first, without their snapshots"""
        with self.get_connection() as conn:
            rows = dict_rows(
                conn.execute(
                    """
                    SELECT * EXCLUDE (personnel_snapshot), '' AS personnel_snapshot
                    FROM rounds WHERE status = 'completed'
                    ORDER BY created_at DESC, id DESC LIMIT ?
                    """,
                    (limit,),
                )
            )
        return [_round(r) for r in rows]

    def get_round_results(self, round_id: int) -> dict:
        """Get comprehensive results for a specific round"""
        with self.get_connection() as conn:
            round_rows = dict_rows(
                conn.execute("SELECT * FROM rounds WHERE id = ?", (round_id,))
            )
            if not round_rows:
                return {}
            ratings = [
                Rating(**r)
                for r in dict_rows(
                    conn.execute(
                        "SELECT * FROM ratings WHERE round_id = ? ORDER BY id",
                        (round_id,),
                    )
                )
            ]

        round_obj = _round(round_rows[0])
        snapshot = json.loads(round_obj.personnel_snapshot)
        start = {p["id"]: p["current_elo"] for p in snapshot}
        final = dict(start)
        for rating in ratings:
            final[rating.ratee_a_id] = rating.ratee_a_elo_after
            final[rating.ratee_b_id] = rating.ratee_b_elo_after

        leaderboard = sorted(
            (
                {
                    "id": p["id"],
                    "name": p["name"],
                    "rank": p["rank"],
                    "band": p.get("band"),
                    "unit": p.get("unit"),
                    "starting_elo": start[p["id"]],
                    "final_elo": final[p["id"]],
                    "elo_change": final[p["id"]] - start[p["id"]],
                }
                for p in snapshot
            ),
            key=lambda x: x["final_elo"],
            reverse=True,
        )
        changes = [row["elo_change"] for row in leaderboard]
        return {
            "round": round_obj.model_copy(update={"personnel_snapshot": ""}),
            "leaderboard": leaderboard,
            "statistics": {
                "total_ratings": sum(r.outcome != CANT_JUDGE for r in ratings),
                "cant_judge": sum(r.outcome == CANT_JUDGE for r in ratings),
                "biggest_elo_gain": max(changes, default=0),
                "biggest_elo_loss": min(changes, default=0),
                "total_personnel": len(snapshot),
            },
            "ratings": ratings,
        }


# Global database instance
db = Database()
