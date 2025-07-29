"""
DuckDB database connection and operations
"""

import itertools
import json
import os
from datetime import datetime
from typing import List, Optional, Tuple

import duckdb

from elo import calculate_elo, get_expected_score, get_rating_change_preview
from models import (
    EloHistoryPoint,
    LeaderboardEntry,
    Matchup,
    Personnel,
    PersonnelCreate,
    PersonnelUpdate,
    Rating,
    Round,
    RoundCreate,
)


class Database:
    def __init__(self, db_path: str = "/app/data/elo_ratings.db"):
        self.db_path = db_path
        # Ensure data directory exists
        os.makedirs(os.path.dirname(db_path), exist_ok=True)
        self.init_database()

    def get_connection(self):
        return duckdb.connect(self.db_path)

    def init_database(self):
        """Initialize database tables"""
        with self.get_connection() as conn:
            # Personnel table
            conn.execute(
                """
                CREATE SEQUENCE IF NOT EXISTS personnel_id_seq START 1
            """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS personnel (
                    id INTEGER PRIMARY KEY DEFAULT nextval('personnel_id_seq'),
                    name VARCHAR NOT NULL,
                    rank VARCHAR NOT NULL,
                    initial_elo INTEGER DEFAULT 1000,
                    current_elo INTEGER DEFAULT 1000,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    active BOOLEAN DEFAULT TRUE
                )
            """
            )

            # Rounds table
            conn.execute(
                """
                CREATE SEQUENCE IF NOT EXISTS rounds_id_seq START 1
            """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS rounds (
                    id INTEGER PRIMARY KEY DEFAULT nextval('rounds_id_seq'),
                    round_name VARCHAR NOT NULL,
                    dtg TIMESTAMP NOT NULL,
                    status VARCHAR DEFAULT 'active',
                    total_matchups INTEGER NOT NULL,
                    completed_matchups INTEGER DEFAULT 0,
                    personnel_snapshot TEXT NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """
            )

            # Matchups table (tracks all possible pairings for a round)
            conn.execute(
                """
                CREATE SEQUENCE IF NOT EXISTS matchups_id_seq START 1
            """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS matchups (
                    id INTEGER PRIMARY KEY DEFAULT nextval('matchups_id_seq'),
                    round_id INTEGER NOT NULL,
                    ratee_a_id INTEGER NOT NULL,
                    ratee_b_id INTEGER NOT NULL,
                    status VARCHAR DEFAULT 'pending',
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(round_id, ratee_a_id, ratee_b_id)
                )
            """
            )

            # Ratings table (updated to include round_id)
            conn.execute(
                """
                CREATE SEQUENCE IF NOT EXISTS ratings_id_seq START 1
            """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS ratings (
                    id INTEGER PRIMARY KEY DEFAULT nextval('ratings_id_seq'),
                    round_id INTEGER NOT NULL,
                    matchup_id INTEGER,
                    rater_id INTEGER,
                    ratee_a_id INTEGER NOT NULL,
                    ratee_b_id INTEGER NOT NULL,
                    winner_id INTEGER,
                    ratee_a_elo_before INTEGER NOT NULL,
                    ratee_b_elo_before INTEGER NOT NULL,
                    ratee_a_elo_after INTEGER NOT NULL,
                    ratee_b_elo_after INTEGER NOT NULL,
                    rated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """
            )

    # Personnel operations
    def create_personnel(self, personnel_data: PersonnelCreate) -> Personnel:
        """Create new personnel entry"""
        with self.get_connection() as conn:
            # Insert and get the returned row with RETURNING clause
            result = conn.execute(
                """
                INSERT INTO personnel (name, rank, initial_elo, current_elo)
                VALUES (?, ?, ?, ?)
                RETURNING *
            """,
                (
                    personnel_data.name,
                    personnel_data.rank,
                    personnel_data.initial_elo,
                    personnel_data.initial_elo,
                ),
            ).fetchone()

            return Personnel(
                id=result[0],
                name=result[1],
                rank=result[2],
                initial_elo=result[3],
                current_elo=result[4],
                created_at=result[5],
                active=result[6],
            )

    def get_personnel(self, personnel_id: int) -> Optional[Personnel]:
        """Get personnel by ID"""
        with self.get_connection() as conn:
            result = conn.execute(
                "SELECT * FROM personnel WHERE id = ? AND active = TRUE",
                (personnel_id,),
            ).fetchone()
            if result:
                return Personnel(
                    id=result[0],
                    name=result[1],
                    rank=result[2],
                    initial_elo=result[3],
                    current_elo=result[4],
                    created_at=result[5],
                    active=result[6],
                )
            return None

    def get_all_personnel(self, active_only: bool = True) -> List[Personnel]:
        """Get all personnel"""
        with self.get_connection() as conn:
            query = "SELECT * FROM personnel"
            if active_only:
                query += " WHERE active = TRUE"
            query += " ORDER BY current_elo DESC"

            results = conn.execute(query).fetchall()
            return [
                Personnel(
                    id=row[0],
                    name=row[1],
                    rank=row[2],
                    initial_elo=row[3],
                    current_elo=row[4],
                    created_at=row[5],
                    active=row[6],
                )
                for row in results
            ]

    def update_personnel(
        self, personnel_id: int, personnel_data: PersonnelUpdate
    ) -> Optional[Personnel]:
        """Update personnel information"""
        with self.get_connection() as conn:
            # First check if personnel exists
            existing = conn.execute(
                "SELECT * FROM personnel WHERE id = ?", (personnel_id,)
            ).fetchone()
            if not existing:
                return None

            # Build dynamic update query
            updates = []
            values = []

            if personnel_data.name is not None:
                updates.append("name = ?")
                values.append(personnel_data.name)
            if personnel_data.rank is not None:
                updates.append("rank = ?")
                values.append(personnel_data.rank)
            if personnel_data.active is not None:
                updates.append("active = ?")
                values.append(personnel_data.active)

            if not updates:
                # Return existing personnel if no updates
                return Personnel(
                    id=existing[0],
                    name=existing[1],
                    rank=existing[2],
                    initial_elo=existing[3],
                    current_elo=existing[4],
                    created_at=existing[5],
                    active=existing[6],
                )

            values.append(personnel_id)
            query = (
                f"UPDATE personnel SET {', '.join(updates)} WHERE id = ? RETURNING *"
            )
            result = conn.execute(query, values).fetchone()

            if result:
                return Personnel(
                    id=result[0],
                    name=result[1],
                    rank=result[2],
                    initial_elo=result[3],
                    current_elo=result[4],
                    created_at=result[5],
                    active=result[6],
                )
            return None

    def update_personnel_elo(self, personnel_id: int, new_elo: int):
        """Update personnel ELO rating"""
        with self.get_connection() as conn:
            conn.execute(
                "UPDATE personnel SET current_elo = ? WHERE id = ?",
                (new_elo, personnel_id),
            )

    # Rating operations
    def create_rating(
        self,
        ratee_a_id: int,
        ratee_b_id: int,
        winner_id: Optional[int],
        rater_id: Optional[int] = None,
    ) -> Rating:
        """Create new rating and update ELO scores (legacy method for backward compatibility)"""
        with self.get_connection() as conn:
            # Check if we have the new schema
            columns = conn.execute("PRAGMA table_info(ratings)").fetchall()
            column_names = [col[1] for col in columns]

            if "round_id" in column_names:
                # New schema - create a temporary round for legacy ratings
                legacy_round = self.get_current_round()
                if not legacy_round:
                    # Create a legacy round
                    legacy_round = self.create_round(
                        RoundCreate(
                            round_name=f"Legacy Round - {datetime.now().strftime('%Y%m%d-%H%M%S')}",
                            dtg=datetime.now(),
                        )
                    )

                # Use the round-based method
                return self.create_round_rating(
                    legacy_round.id, None, ratee_a_id, ratee_b_id, winner_id, rater_id
                )
            else:
                # Old schema - legacy code (should not be reached in current implementation)
                # Get current ELO ratings
                person_a = self.get_personnel(ratee_a_id)
                person_b = self.get_personnel(ratee_b_id)

                if not person_a or not person_b:
                    raise ValueError("Personnel not found")

                # Determine result value for ELO calculation
                if winner_id == ratee_a_id:
                    result = 1.0  # A wins
                elif winner_id == ratee_b_id:
                    result = 0.0  # B wins
                else:
                    result = 0.5  # Draw

                # Calculate new ELO ratings
                new_elo_a, new_elo_b = calculate_elo(
                    person_a.current_elo, person_b.current_elo, result
                )

                # Insert rating record and return it (old schema)
                result = conn.execute(
                    """
                    INSERT INTO ratings (rater_id, ratee_a_id, ratee_b_id, winner_id,
                                       ratee_a_elo_before, ratee_b_elo_before,
                                       ratee_a_elo_after, ratee_b_elo_after)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    RETURNING *
                """,
                    (
                        rater_id,
                        ratee_a_id,
                        ratee_b_id,
                        winner_id,
                        person_a.current_elo,
                        person_b.current_elo,
                        new_elo_a,
                        new_elo_b,
                    ),
                ).fetchone()

                # Update personnel ELO ratings
                self.update_personnel_elo(ratee_a_id, new_elo_a)
                self.update_personnel_elo(ratee_b_id, new_elo_b)

                # Return with dummy round_id for compatibility
                return Rating(
                    id=result[0],
                    round_id=0,  # Dummy value for old schema
                    matchup_id=None,
                    rater_id=result[1],
                    ratee_a_id=result[2],
                    ratee_b_id=result[3],
                    winner_id=result[4],
                    ratee_a_elo_before=result[5],
                    ratee_b_elo_before=result[6],
                    ratee_a_elo_after=result[7],
                    ratee_b_elo_after=result[8],
                    rated_at=result[9],
                )

    def get_rating_history(self, limit: int = 100) -> List[Rating]:
        """Get recent rating history"""
        with self.get_connection() as conn:
            # First check if the ratings table has the new schema
            columns = conn.execute("PRAGMA table_info(ratings)").fetchall()
            column_names = [col[1] for col in columns]

            if "round_id" in column_names:
                # New schema
                results = conn.execute(
                    """
                    SELECT * FROM ratings
                    ORDER BY rated_at DESC
                    LIMIT ?
                """,
                    (limit,),
                ).fetchall()

                return [
                    Rating(
                        id=row[0],
                        round_id=row[1],
                        matchup_id=row[2],
                        rater_id=row[3],
                        ratee_a_id=row[4],
                        ratee_b_id=row[5],
                        winner_id=row[6],
                        ratee_a_elo_before=row[7],
                        ratee_b_elo_before=row[8],
                        ratee_a_elo_after=row[9],
                        ratee_b_elo_after=row[10],
                        rated_at=row[11],
                    )
                    for row in results
                ]
            else:
                # Old schema - return empty list for now
                return []

    def get_elo_progression(self) -> List[EloHistoryPoint]:
        """Get ELO progression data for charting"""
        with self.get_connection() as conn:
            results = conn.execute(
                """
                SELECT
                    p.id as personnel_id,
                    p.name,
                    p.rank,
                    r.rated_at,
                    CASE
                        WHEN p.id = r.ratee_a_id THEN r.ratee_a_elo_after
                        WHEN p.id = r.ratee_b_id THEN r.ratee_b_elo_after
                    END as elo_score
                FROM personnel p
                JOIN ratings r ON p.id = r.ratee_a_id OR p.id = r.ratee_b_id
                WHERE p.active = TRUE
                ORDER BY r.rated_at
            """
            ).fetchall()

            return [
                EloHistoryPoint(
                    personnel_id=row[0],
                    name=row[1],
                    rank=row[2],
                    rated_at=row[3],
                    elo_score=row[4],
                )
                for row in results
            ]

    def get_elo_progression_by_rounds(self) -> List[dict]:
        """Get ELO progression data grouped by completed rounds"""
        with self.get_connection() as conn:
            # Get all completed rounds
            completed_rounds = conn.execute(
                """
                SELECT id, round_name, dtg, personnel_snapshot
                FROM rounds
                WHERE status = 'completed'
                ORDER BY dtg
            """
            ).fetchall()

            if not completed_rounds:
                return []

            progression_data = []

            # Add initial state (Round 0 - starting ELOs)
            if completed_rounds:
                import json

                first_round_snapshot = json.loads(completed_rounds[0][3])

                for person in first_round_snapshot:
                    progression_data.append(
                        {
                            "personnel_id": person["id"],
                            "name": person["name"],
                            "rank": person["rank"],
                            "round_name": "Starting ELO",
                            "round_number": 0,
                            "elo_score": person["current_elo"],
                            "round_dtg": completed_rounds[0][
                                2
                            ],  # Use first round's DTG
                        }
                    )

            # Add final ELO for each completed round
            for round_idx, round_data in enumerate(completed_rounds):
                round_id, round_name, round_dtg, personnel_snapshot = round_data
                round_number = round_idx + 1

                # Get final ELO scores for this round by getting the round results
                round_results = self.get_round_results(round_id)
                if round_results and "leaderboard" in round_results:
                    for person in round_results["leaderboard"]:
                        progression_data.append(
                            {
                                "personnel_id": person["id"],
                                "name": person["name"],
                                "rank": person["rank"],
                                "round_name": round_name,
                                "round_number": round_number,
                                "elo_score": person["final_elo"],
                                "round_dtg": round_dtg,
                            }
                        )

            return progression_data

    def get_comparison_pair(self) -> Optional[Tuple[Personnel, Personnel]]:
        """Get next pair for comparison (random selection)"""
        with self.get_connection() as conn:
            # Get random pair of active personnel
            results = conn.execute(
                """
                SELECT * FROM personnel
                WHERE active = TRUE
                ORDER BY RANDOM()
                LIMIT 2
            """
            ).fetchall()

            if len(results) < 2:
                return None

            person_a = Personnel(
                id=results[0][0],
                name=results[0][1],
                rank=results[0][2],
                initial_elo=results[0][3],
                current_elo=results[0][4],
                created_at=results[0][5],
                active=results[0][6],
            )

            person_b = Personnel(
                id=results[1][0],
                name=results[1][1],
                rank=results[1][2],
                initial_elo=results[1][3],
                current_elo=results[1][4],
                created_at=results[1][5],
                active=results[1][6],
            )

            return person_a, person_b

    # Round management methods
    def create_round(self, round_data: RoundCreate) -> Round:
        """Create a new round with all possible matchups"""
        with self.get_connection() as conn:
            # Get all active personnel for this round
            active_personnel = self.get_all_personnel(active_only=True)

            if len(active_personnel) < 2:
                raise ValueError("Need at least 2 active personnel to create a round")

            # Calculate total matchups (n choose 2)
            total_matchups = len(active_personnel) * (len(active_personnel) - 1) // 2

            # Use current timestamp if DTG not provided
            dtg = round_data.dtg or datetime.now()

            # Create personnel snapshot
            personnel_snapshot = json.dumps(
                [
                    {
                        "id": p.id,
                        "name": p.name,
                        "rank": p.rank,
                        "current_elo": p.current_elo,
                    }
                    for p in active_personnel
                ]
            )

            # Create the round
            result = conn.execute(
                """
                INSERT INTO rounds (round_name, dtg, total_matchups, personnel_snapshot)
                VALUES (?, ?, ?, ?)
                RETURNING *
            """,
                (round_data.round_name, dtg, total_matchups, personnel_snapshot),
            ).fetchone()

            round_obj = Round(
                id=result[0],
                round_name=result[1],
                dtg=result[2],
                status=result[3],
                total_matchups=result[4],
                completed_matchups=result[5],
                personnel_snapshot=result[6],
                created_at=result[7],
            )

            # Create all possible matchups
            print(
                f"🔧 Creating matchups for round {round_obj.id} with {len(active_personnel)} personnel"
            )
            matchup_count = 0
            for person_a, person_b in itertools.combinations(active_personnel, 2):
                conn.execute(
                    """
                    INSERT INTO matchups (round_id, ratee_a_id, ratee_b_id)
                    VALUES (?, ?, ?)
                """,
                    (round_obj.id, person_a.id, person_b.id),
                )
                matchup_count += 1
                print(
                    f"🔧 Created matchup {matchup_count}: {person_a.name} ({person_a.id}) vs {person_b.name} ({person_b.id})"
                )

            # Explicitly commit the transaction
            conn.commit()
            print(f"✅ Created {matchup_count} matchups for round {round_obj.id}")

            return round_obj

    def get_current_round(self) -> Optional[Round]:
        """Get the current active round"""
        with self.get_connection() as conn:
            result = conn.execute(
                """
                SELECT * FROM rounds
                WHERE status = 'active'
                ORDER BY created_at DESC
                LIMIT 1
            """
            ).fetchone()

            if result:
                return Round(
                    id=result[0],
                    round_name=result[1],
                    dtg=result[2],
                    status=result[3],
                    total_matchups=result[4],
                    completed_matchups=result[5],
                    personnel_snapshot=result[6],
                    created_at=result[7],
                )
            return None

    def get_next_matchup(self, round_id: int) -> Optional[Matchup]:
        """Get the next pending matchup for a round"""
        with self.get_connection() as conn:
            result = conn.execute(
                """
                SELECT * FROM matchups
                WHERE round_id = ? AND status = 'pending'
                ORDER BY created_at
                LIMIT 1
            """,
                (round_id,),
            ).fetchone()

            if result:
                return Matchup(
                    id=result[0],
                    round_id=result[1],
                    ratee_a_id=result[2],
                    ratee_b_id=result[3],
                    status=result[4],
                    created_at=result[5],
                )
            return None

    def complete_matchup(self, matchup_id: int):
        """Mark a matchup as completed"""
        with self.get_connection() as conn:
            conn.execute(
                """
                UPDATE matchups SET status = 'completed' WHERE id = ?
            """,
                (matchup_id,),
            )

            # Update round completion count
            matchup = conn.execute(
                "SELECT round_id FROM matchups WHERE id = ?", (matchup_id,)
            ).fetchone()
            if matchup:
                round_id = matchup[0]
                conn.execute(
                    """
                    UPDATE rounds SET completed_matchups = completed_matchups + 1
                    WHERE id = ?
                """,
                    (round_id,),
                )

                # Check if round is complete
                round_info = conn.execute(
                    """
                    SELECT total_matchups, completed_matchups FROM rounds WHERE id = ?
                """,
                    (round_id,),
                ).fetchone()

                if round_info and round_info[1] >= round_info[0]:
                    conn.execute(
                        """
                        UPDATE rounds SET status = 'completed' WHERE id = ?
                    """,
                        (round_id,),
                    )

    def get_round_progress(self, round_id: int) -> dict:
        """Get progress information for a round"""
        with self.get_connection() as conn:
            result = conn.execute(
                """
                SELECT total_matchups, completed_matchups, status FROM rounds WHERE id = ?
            """,
                (round_id,),
            ).fetchone()

            if result:
                total, completed, status = result
                return {
                    "total_matchups": total,
                    "completed_matchups": completed,
                    "remaining_matchups": total - completed,
                    "completion_percentage": (completed / total * 100)
                    if total > 0
                    else 0,
                    "status": status,
                }
            return {}

    def get_round_based_comparison_pair(self):
        """Get next comparison pair from current round system"""
        # Get current round (do NOT auto-create)
        current_round = self.get_current_round()

        if not current_round:
            # No active round - return None to trigger round completion flow
            return None

        # Check if current round is already completed
        if current_round.status == "completed":
            return None

        # Get next matchup
        next_matchup = self.get_next_matchup(current_round.id)
        if not next_matchup:
            # No pending matchups - check if round should be marked complete
            progress = self.get_round_progress(current_round.id)
            if (
                progress
                and progress["completed_matchups"] >= progress["total_matchups"]
            ):
                # Mark round as completed
                with self.get_connection() as conn:
                    conn.execute(
                        "UPDATE rounds SET status = 'completed' WHERE id = ?",
                        (current_round.id,),
                    )
            return None

        # Get personnel for this matchup
        person_a = self.get_personnel(next_matchup.ratee_a_id)
        person_b = self.get_personnel(next_matchup.ratee_b_id)

        if not person_a or not person_b:
            return None

        progress = self.get_round_progress(current_round.id)

        return {
            "round_info": current_round,
            "matchup": next_matchup,
            "person_a": person_a,
            "person_b": person_b,
            "progress": progress,
        }

    def create_initial_round_if_needed(self):
        """Create first round only when explicitly called"""
        current_round = self.get_current_round()
        if current_round:
            return current_round

        # Create first round
        active_personnel = self.get_all_personnel(active_only=True)
        if len(active_personnel) < 2:
            return None

        return self.create_round(
            RoundCreate(
                round_name=f"Round 1 - {datetime.now().strftime('%Y%m%d-%H%M%S')}",
                dtg=datetime.now(),
            )
        )

    def create_round_rating(
        self,
        round_id: int,
        matchup_id: int,
        ratee_a_id: int,
        ratee_b_id: int,
        winner_id: Optional[int],
        rater_id: Optional[int] = None,
    ) -> Rating:
        """Create rating within a round context"""
        with self.get_connection() as conn:
            # Get current ELO ratings
            person_a = self.get_personnel(ratee_a_id)
            person_b = self.get_personnel(ratee_b_id)

            if not person_a or not person_b:
                raise ValueError("Personnel not found")

            # Determine result value for ELO calculation
            if winner_id == ratee_a_id:
                result = 1.0  # A wins
            elif winner_id == ratee_b_id:
                result = 0.0  # B wins
            else:
                result = 0.5  # Draw

            # Calculate new ELO ratings
            new_elo_a, new_elo_b = calculate_elo(
                person_a.current_elo, person_b.current_elo, result
            )

            # Get round DTG for consistent timestamps
            round_dtg = conn.execute(
                "SELECT dtg FROM rounds WHERE id = ?", (round_id,)
            ).fetchone()[0]

            # Insert rating record with round DTG
            result = conn.execute(
                """
                INSERT INTO ratings (round_id, matchup_id, rater_id, ratee_a_id, ratee_b_id, winner_id,
                                   ratee_a_elo_before, ratee_b_elo_before,
                                   ratee_a_elo_after, ratee_b_elo_after, rated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                RETURNING *
            """,
                (
                    round_id,
                    matchup_id,
                    rater_id,
                    ratee_a_id,
                    ratee_b_id,
                    winner_id,
                    person_a.current_elo,
                    person_b.current_elo,
                    new_elo_a,
                    new_elo_b,
                    round_dtg,
                ),
            ).fetchone()

            # Update personnel ELO ratings
            self.update_personnel_elo(ratee_a_id, new_elo_a)
            self.update_personnel_elo(ratee_b_id, new_elo_b)

            # Mark matchup as completed
            self.complete_matchup(matchup_id)

            return Rating(
                id=result[0],
                round_id=result[1],
                matchup_id=result[2],
                rater_id=result[3],
                ratee_a_id=result[4],
                ratee_b_id=result[5],
                winner_id=result[6],
                ratee_a_elo_before=result[7],
                ratee_b_elo_before=result[8],
                ratee_a_elo_after=result[9],
                ratee_b_elo_after=result[10],
                rated_at=result[11],
            )

    def get_completed_rounds(self) -> List[Round]:
        """Get all completed rounds ordered by completion date"""
        with self.get_connection() as conn:
            results = conn.execute(
                """
                SELECT * FROM rounds
                WHERE status = 'completed'
                ORDER BY created_at DESC
            """
            ).fetchall()

            return [
                Round(
                    id=row[0],
                    round_name=row[1],
                    dtg=row[2],
                    status=row[3],
                    total_matchups=row[4],
                    completed_matchups=row[5],
                    personnel_snapshot=row[6],
                    created_at=row[7],
                )
                for row in results
            ]

    def get_round_results(self, round_id: int) -> dict:
        """Get comprehensive results for a specific round"""
        with self.get_connection() as conn:
            # Get round info
            round_result = conn.execute(
                "SELECT * FROM rounds WHERE id = ?", (round_id,)
            ).fetchone()
            if not round_result:
                return {}

            round_obj = Round(
                id=round_result[0],
                round_name=round_result[1],
                dtg=round_result[2],
                status=round_result[3],
                total_matchups=round_result[4],
                completed_matchups=round_result[5],
                personnel_snapshot=round_result[6],
                created_at=round_result[7],
            )

            # Get personnel snapshot from the round
            import json

            personnel_snapshot = json.loads(round_obj.personnel_snapshot)

            # Get all ratings for this round
            ratings = conn.execute(
                """
                SELECT * FROM ratings WHERE round_id = ? ORDER BY rated_at
            """,
                (round_id,),
            ).fetchall()

            # Calculate final ELO standings for this round
            final_elos = {}
            elo_changes = {}

            # Initialize with starting ELOs from snapshot
            for person in personnel_snapshot:
                person_id = person["id"]
                starting_elo = person["current_elo"]
                final_elos[person_id] = starting_elo
                elo_changes[person_id] = 0

            # Apply all rating changes in order
            for rating in ratings:
                ratee_a_id = rating[4]
                ratee_b_id = rating[5]
                a_elo_after = rating[9]
                b_elo_after = rating[10]
                a_elo_before = rating[7]
                b_elo_before = rating[8]

                final_elos[ratee_a_id] = a_elo_after
                final_elos[ratee_b_id] = b_elo_after
                elo_changes[ratee_a_id] = (
                    a_elo_after
                    - personnel_snapshot[
                        next(
                            i
                            for i, p in enumerate(personnel_snapshot)
                            if p["id"] == ratee_a_id
                        )
                    ]["current_elo"]
                )
                elo_changes[ratee_b_id] = (
                    b_elo_after
                    - personnel_snapshot[
                        next(
                            i
                            for i, p in enumerate(personnel_snapshot)
                            if p["id"] == ratee_b_id
                        )
                    ]["current_elo"]
                )

            # Create final leaderboard
            leaderboard = []
            for person in personnel_snapshot:
                person_id = person["id"]
                leaderboard.append(
                    {
                        "id": person_id,
                        "name": person["name"],
                        "rank": person["rank"],
                        "starting_elo": person["current_elo"],
                        "final_elo": final_elos[person_id],
                        "elo_change": elo_changes[person_id],
                    }
                )

            # Sort by final ELO
            leaderboard.sort(key=lambda x: x["final_elo"], reverse=True)

            # Calculate statistics
            total_ratings = len(ratings)
            biggest_gain = max(elo_changes.values()) if elo_changes else 0
            biggest_loss = min(elo_changes.values()) if elo_changes else 0

            return {
                "round": round_obj,
                "leaderboard": leaderboard,
                "statistics": {
                    "total_ratings": total_ratings,
                    "biggest_elo_gain": biggest_gain,
                    "biggest_elo_loss": biggest_loss,
                    "total_personnel": len(personnel_snapshot),
                },
                "ratings": [
                    Rating(
                        id=r[0],
                        round_id=r[1],
                        matchup_id=r[2],
                        rater_id=r[3],
                        ratee_a_id=r[4],
                        ratee_b_id=r[5],
                        winner_id=r[6],
                        ratee_a_elo_before=r[7],
                        ratee_b_elo_before=r[8],
                        ratee_a_elo_after=r[9],
                        ratee_b_elo_after=r[10],
                        rated_at=r[11],
                    )
                    for r in ratings
                ],
            }


# Global database instance
db = Database()
