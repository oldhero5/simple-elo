"""A single DuckDB connection per process, serialized by a lock."""

import logging
import threading
from collections.abc import Iterator, Sequence
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import duckdb
from fastapi import Request

from migrations import migrate

logger = logging.getLogger(__name__)

Connection = duckdb.DuckDBPyConnection


def utcnow() -> datetime:
    """Current time as naive UTC, which is how every timestamp column is stored."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


def fetch_all(
    conn: Connection, sql: str, params: Sequence[Any] = ()
) -> list[dict[str, Any]]:
    cursor = conn.execute(sql, params)
    columns = [column[0] for column in cursor.description]
    return [dict(zip(columns, row)) for row in cursor.fetchall()]


def fetch_one(
    conn: Connection, sql: str, params: Sequence[Any] = ()
) -> dict[str, Any] | None:
    rows = fetch_all(conn, sql, params)
    return rows[0] if rows else None


def fetch_value(conn: Connection, sql: str, params: Sequence[Any] = ()) -> Any:
    row = conn.execute(sql, params).fetchone()
    return row[0] if row else None


class Database:
    def __init__(self, path: Path) -> None:
        self.path = path
        self._conn: Connection | None = None
        # A DuckDB connection must not be used by two threads at once, and FastAPI
        # runs the sync endpoints in a thread pool, so every use goes through this.
        self._lock = threading.Lock()

    def open(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = duckdb.connect(str(self.path))
        # Column defaults use CURRENT_TIMESTAMP; make them land in UTC like the
        # explicit values the app writes.
        self._conn.execute("SET TimeZone = 'UTC'")
        with self.transaction() as conn:
            migrate(conn)
        # Fold the migration into the database file right away. DuckDB 1.4 and
        # 1.5 cannot replay an ALTER TABLE ... ADD COLUMN on a table with a
        # nextval() or CURRENT_TIMESTAMP default from the write-ahead log, so if
        # the process were killed before its next checkpoint (a crash, power
        # loss, a container killed without a clean stop) the file would no
        # longer open. Later writes are plain DML, which replays fine.
        self._conn.execute("CHECKPOINT")
        logger.info("Opened database at %s", self.path)

    def close(self) -> None:
        with self._lock:
            if self._conn is not None:
                self._conn.close()
                self._conn = None

    def _connection(self) -> Connection:
        if self._conn is None:
            raise RuntimeError("Database is not open")
        return self._conn

    @contextmanager
    def transaction(self) -> Iterator[Connection]:
        """Run the block in one transaction; any exception rolls everything back."""
        with self._lock:
            conn = self._connection()
            conn.execute("BEGIN TRANSACTION")
            try:
                yield conn
                conn.execute("COMMIT")
            except BaseException:
                try:
                    conn.execute("ROLLBACK")
                except duckdb.Error:
                    # A failed COMMIT has already ended the transaction.
                    pass
                raise

    @contextmanager
    def read(self) -> Iterator[Connection]:
        """Read-only access. Callers must not write through this connection."""
        with self._lock:
            yield self._connection()


def get_db(request: Request) -> Database:
    return request.app.state.db
