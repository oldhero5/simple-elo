"""Schema creation and migrations.

Version 1 is the schema the first release created. It had no schema_version
table, so a database without one is treated as version 1. A new database is
created in the version 1 shape and then migrated, so fresh and upgraded
databases always end up identical.
"""

import logging
from datetime import datetime, timezone

import duckdb

logger = logging.getLogger(__name__)

SCHEMA_VERSION = 2

_BASE_SCHEMA = (
    "CREATE SEQUENCE IF NOT EXISTS personnel_id_seq START 1",
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
    """,
    "CREATE SEQUENCE IF NOT EXISTS rounds_id_seq START 1",
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
    """,
    "CREATE SEQUENCE IF NOT EXISTS matchups_id_seq START 1",
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
    """,
    "CREATE SEQUENCE IF NOT EXISTS ratings_id_seq START 1",
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
    """,
    "CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)",
)


def _migrate_to_2(conn: duckdb.DuckDBPyConnection, now: datetime) -> None:
    conn.execute("ALTER TABLE matchups ADD COLUMN IF NOT EXISTS position INTEGER")
    conn.execute("UPDATE matchups SET position = id WHERE position IS NULL")
    conn.execute("ALTER TABLE rounds ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP")

    # Version 1 accepted an explicit null initial_elo, which broke every list.
    conn.execute(
        """
        UPDATE personnel SET
            initial_elo = COALESCE(initial_elo, 1000),
            current_elo = COALESCE(current_elo, initial_elo, 1000),
            active = COALESCE(active, TRUE),
            created_at = COALESCE(created_at, ?)
        WHERE initial_elo IS NULL OR current_elo IS NULL
            OR active IS NULL OR created_at IS NULL
        """,
        (now,),
    )

    # Version 1 could leave several rounds active at once; keep the newest.
    conn.execute("""
        UPDATE rounds SET status = 'completed'
        WHERE status = 'active'
            AND id <> (SELECT max(id) FROM rounds WHERE status = 'active')
        """)
    # Pending matchups that can never be rated: their round was closed early,
    # or someone in them was deactivated.
    conn.execute("""
        UPDATE matchups SET status = 'cancelled'
        WHERE status = 'pending' AND (
            round_id NOT IN (SELECT id FROM rounds WHERE status = 'active')
            OR ratee_a_id NOT IN (SELECT id FROM personnel WHERE active)
            OR ratee_b_id NOT IN (SELECT id FROM personnel WHERE active)
        )
        """)
    conn.execute("""
        UPDATE rounds SET status = 'completed'
        WHERE status = 'active' AND NOT EXISTS (
            SELECT 1 FROM matchups m
            WHERE m.round_id = rounds.id AND m.status = 'pending'
        )
        """)
    # Version 1 counters drifted (double submits counted twice). Recount them.
    # It also stamped every rating with the round start time, so the
    # completed_at backfilled here is only approximate for old rounds.
    conn.execute("""
        UPDATE rounds SET
            total_matchups = (
                SELECT count(*) FROM matchups m
                WHERE m.round_id = rounds.id AND m.status <> 'cancelled'
            ),
            completed_matchups = (
                SELECT count(*) FROM matchups m
                WHERE m.round_id = rounds.id AND m.status = 'completed'
            ),
            completed_at = CASE WHEN status = 'completed' THEN COALESCE(
                completed_at,
                (SELECT max(r.rated_at) FROM ratings r WHERE r.round_id = rounds.id),
                dtg
            ) END,
            created_at = COALESCE(created_at, dtg)
        """)


_MIGRATIONS = {2: _migrate_to_2}


def migrate(conn: duckdb.DuckDBPyConnection) -> None:
    """Bring the schema up to SCHEMA_VERSION. Safe to run on every start."""
    existing = conn.execute(
        "SELECT count(*) FROM information_schema.tables WHERE table_name = 'personnel'"
    ).fetchone()[0]
    for statement in _BASE_SCHEMA:
        conn.execute(statement)

    row = conn.execute("SELECT max(version) FROM schema_version").fetchone()
    version = row[0] if row and row[0] is not None else 1
    if version > SCHEMA_VERSION:
        raise RuntimeError(
            f"Database schema version {version} is newer than this app supports "
            f"({SCHEMA_VERSION})"
        )
    if version == SCHEMA_VERSION:
        return

    if not existing:
        logger.info("Creating database schema version %d", SCHEMA_VERSION)
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    for target in range(version + 1, SCHEMA_VERSION + 1):
        if existing:
            logger.info("Migrating database schema to version %d", target)
        _MIGRATIONS[target](conn, now)
    conn.execute("DELETE FROM schema_version")
    conn.execute("INSERT INTO schema_version (version) VALUES (?)", (SCHEMA_VERSION,))
