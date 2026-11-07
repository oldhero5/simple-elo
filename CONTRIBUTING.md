# Contributing

## Setup

You need Python 3.12 and [uv](https://docs.astral.sh/uv/), Node.js 22 with npm, and Docker with the Compose plugin to run the full stack.

```bash
git clone https://github.com/oldhero5/simple-elo.git
cd simple-elo

# Repo tooling: pre-commit and detect-secrets, from pyproject.toml and uv.lock
uv sync
uv run pre-commit install

# Backend
cd backend
uv venv --python 3.12
source .venv/bin/activate
uv pip install -r requirements-dev.txt
cd ..

# Frontend
cd frontend
npm install
cd ..
```

The backend is a plain directory of modules with its dependencies in `requirements.txt` (runtime) and `requirements-dev.txt` (adds pytest, httpx and flake8). Use the activated virtualenv for backend commands rather than `uv run`, which would treat `backend/` as a uv project and write a lockfile there.

## Run it

```bash
# backend/, venv active: http://127.0.0.1:8000
uvicorn main:app --reload

# frontend/: http://localhost:3000, forwards /api to API_URL (default http://localhost:8000)
npm run dev
```

Or run the whole stack with `docker compose up -d --build`. The README covers [configuration](README.md#configuration) and the database file.

## Checks

Run these before you open a pull request. CI (`.github/workflows/ci.yml`) runs the same backend and frontend checks and validates the compose file.

```bash
# backend/, venv active
pytest
flake8 .

# frontend/
npm run lint
npm run typecheck
npm run build

# repo root
uv run pre-commit run --all-files
```

The pre-commit hooks are:

- file hygiene from pre-commit-hooks: trailing whitespace, final newline, LF line endings, YAML/JSON/TOML syntax, merge conflict markers, case conflicts, shebangs and executable bits, large files, private keys, sorted `requirements*.txt`
- black and isort on `backend/` (settings in `backend/pyproject.toml`)
- flake8 on `backend/`, with the same arguments as CI
- bandit on `backend/` except tests (settings in `backend/pyproject.toml`)
- detect-secrets against `.secrets.baseline`
- yamllint (settings in `.yamllint.yml`)

The hooks do not cover the frontend, because they would need `frontend/node_modules`; run the npm scripts above. Frontend formatting settings are in `frontend/.prettierrc`. Prettier is not a project dependency, so run it with `npx prettier@3 --write <files>`.

If detect-secrets flags something that is not a secret, refresh the baseline and review the diff before you commit it:

```bash
uv run detect-secrets scan --baseline .secrets.baseline
```

## Making changes

- **API.** Request and response models are in `backend/schemas.py` and the routes in `backend/routers/`. Mirror any change in `frontend/lib/types.ts` and `frontend/lib/api.ts`, and add tests under `backend/tests/`.
- **Database schema.** Add a step to `backend/migrations.py` and raise `SCHEMA_VERSION`. A fresh database and an upgraded one must end up with the same schema; `backend/tests/test_migration.py` checks that. People run this against their existing `data/elo_ratings.db`, so migrations must be idempotent.
- **Reads and writes.** GET endpoints read through `Database.read()` and must not write. A write that touches more than one row goes in a single `Database.transaction()`.
- **Frontend data.** Call the backend through `frontend/lib/api.ts` with relative `/api/...` URLs, and load data with the `useApi` and `useAction` hooks in `frontend/lib/useApi.ts`. `frontend/components/ui.tsx` has the shared buttons, tables, alerts and form controls.
- **Writing style.** Write "Elo", not "ELO", in UI copy and docs. Use sentence case and no exclamation marks. Use commas, colons or parentheses rather than em dashes.

## Pull requests

Open pull requests against `main`. Keep each one to one change, describe what changed and how you tested it, and include screenshots for UI changes (a phone width and a desktop width).

Report security problems privately as described in [SECURITY.md](SECURITY.md), not in a public issue.
