import os
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))

# database.py opens a module-level instance on import; keep it off real data.
os.environ.setdefault("DATABASE_URL", "/tmp/simple-elo-pytest-import.db")
