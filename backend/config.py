"""Runtime settings read from the environment."""

import os
from dataclasses import dataclass, field
from pathlib import Path

DEFAULT_DATABASE_PATH = (
    Path(__file__).resolve().parent.parent / "data" / "elo_ratings.db"
)


@dataclass(frozen=True)
class Settings:
    database_path: Path = DEFAULT_DATABASE_PATH
    cors_origins: tuple[str, ...] = field(default_factory=tuple)
    log_level: str = "INFO"

    @classmethod
    def from_env(cls) -> "Settings":
        # DATABASE_URL is what the old docker-compose.yml set; keep honouring it so
        # an un-updated compose file still finds the existing database.
        raw_path = os.environ.get("DATABASE_PATH") or os.environ.get("DATABASE_URL")
        database_path = (
            Path(raw_path).expanduser().resolve() if raw_path else DEFAULT_DATABASE_PATH
        )
        origins = tuple(
            origin.strip()
            for origin in os.environ.get("CORS_ORIGINS", "").split(",")
            if origin.strip()
        )
        log_level = os.environ.get("LOG_LEVEL", "INFO").upper()
        return cls(
            database_path=database_path, cors_origins=origins, log_level=log_level
        )
