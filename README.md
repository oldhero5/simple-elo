# simple-elo

Elo Rater ranks the people on a team by head-to-head comparison. You add people, start a round, and pick the stronger of two people for every pair in the round (or call it a draw). Each choice updates both ratings with the Elo system, and the dashboard shows the standings, recent ratings and rating history. It is a FastAPI and DuckDB backend with a Next.js frontend, run with Docker Compose, and it works from a phone over Tailscale.

- [Quick start](#quick-start)
- [Open it from your phone over Tailscale](#open-it-from-your-phone-over-tailscale)
- [Local development](#local-development)
- [Tests and checks](#tests-and-checks)
- [How rating works](#how-rating-works)
- [API](#api)
- [Configuration](#configuration)
- [Data and backups](#data-and-backups)
- [Project layout](#project-layout)

## Quick start

Needs Docker with the Compose plugin (`docker compose`, not the old `docker-compose`).

```bash
git clone https://github.com/oldhero5/simple-elo.git
cd simple-elo
docker compose up -d --build
```

Open http://localhost:3000, add at least two people on the Personnel page, then start round 1 from the Dashboard or the Rate page.

| Task | Command |
| --- | --- |
| Follow the logs | `docker compose logs -f` |
| Stop (data is kept in `./data`) | `docker compose down` |
| Update | `git pull && docker compose up -d --build` |

Only the web UI is published, on port 3000. The backend is reachable only from the frontend container, which forwards `/api` requests to it.

## Open it from your phone over Tailscale

The app has no login. Anyone who can open it can add and edit people, record ratings and end rounds. Keep it on your tailnet and do not turn on Tailscale Funnel, which would put it on the public internet.

Pick one of these:

1. **The host is already on your tailnet.** Open `http://<host>:3000` on the phone, where `<host>` is the machine's MagicDNS name (or its `100.x.y.z` Tailscale IP). Nothing else to set up.
2. **HTTPS from the host's Tailscale.** On the host, run:

   ```bash
   tailscale serve --bg 3000
   ```

   Then open `https://<host>.<tailnet>.ts.net`. This needs MagicDNS and HTTPS certificates turned on for the tailnet (admin console, DNS page). `tailscale serve status` shows the address, and `tailscale serve reset` removes this host's serve config again.
3. **The Tailscale sidecar in this repo.** Use this when the host is not on your tailnet, or when the app should be its own tailnet machine.

   ```bash
   cp .env.example .env
   # set TS_AUTHKEY in .env (create a key at https://login.tailscale.com/admin/settings/keys)
   docker compose --profile tailscale up -d --build
   ```

   Then open `https://elo.<tailnet>.ts.net` (the name comes from `TS_HOSTNAME`). If you leave `TS_AUTHKEY` empty, `docker compose logs tailscale` prints a login URL instead. The sidecar's serve config in `tailscale/serve.json` sets `AllowFunnel` to false. HTTPS certificates must be turned on for the tailnet, as in option 2.

Tip: by default port 3000 is published on every interface, so devices on your LAN can open the app too. To limit that, set `ELO_BIND` in `.env` (copy it from `.env.example` first) and run `docker compose up -d` again:

- `ELO_BIND=<output of tailscale ip -4>` keeps the app off the LAN but reachable over the tailnet (option 1). That address must exist when the container starts, so if Docker comes up before Tailscale after a reboot, run `docker compose up -d` again.
- `ELO_BIND=127.0.0.1` makes the HTTPS address the only way in from other devices (options 2 and 3).

On a phone you can put it on the home screen with the browser's "Add to Home Screen".

## Local development

Needs Python 3.12 with [uv](https://docs.astral.sh/uv/), and Node.js 22 with npm.

Backend, on http://127.0.0.1:8000:

```bash
cd backend
uv venv --python 3.12
source .venv/bin/activate
uv pip install -r requirements-dev.txt
uvicorn main:app --reload
```

Frontend, on http://localhost:3000, in a second terminal:

```bash
cd frontend
npm install
npm run dev
```

The browser only talks to the frontend. Its route handler at `frontend/app/api/[...path]/route.ts` forwards every `/api/...` request to `API_URL` (default `http://localhost:8000`), read at request time. If the backend is not running, `/api` calls return 502 with `{"detail": "Backend unavailable"}`. `next dev` listens on all interfaces, so `http://<host>:3000` also works from a phone on the tailnet while you develop.

The local backend uses `data/elo_ratings.db` at the repo root, the same file as the Docker stack. Do not run both against it at once. After the Docker stack has run, `data/` belongs to uid 10001, so give the local backend its own file instead, for example `DATABASE_PATH=/tmp/elo-dev.db uvicorn main:app --reload`.

## Tests and checks

| Where | Command | What it does |
| --- | --- | --- |
| `backend/`, venv active | `pytest` | API, Elo, round, migration and read-only tests |
| `backend/`, venv active | `flake8 .` | Lint (settings in `backend/.flake8`) |
| `frontend/` | `npm run lint` | ESLint 9 with the Next.js config (`eslint.config.mjs`) |
| `frontend/` | `npm run typecheck` | `next typegen`, then `tsc --noEmit` |
| `frontend/` | `npm run build` | Production build |
| repo root | `uv sync`, then `uv run pre-commit run --all-files` | The pre-commit hooks, see [CONTRIBUTING.md](CONTRIBUTING.md) |

CI (`.github/workflows/ci.yml`) runs the backend and frontend checks above on pushes to `main` and on pull requests, and validates the compose file with `docker compose config`.

## How rating works

- **Rounds.** Starting a round pairs every active person with every other active person once, so 6 people make 15 matchups. The order of the pairs is shuffled, and which person appears on the left is random for each pair, so the top-rated person is not always shown first.
- **Voting.** For each pair, pick the left person, the right person, or Draw. Skip moves the pair to the end of the round's queue so it comes back later. On a phone, tap the names; on a keyboard, use Left arrow or 1, Right arrow or 2, D for draw and S for skip.
- **Hidden ratings.** The Rate page shows only rank and name by default, so current ratings do not anchor the choice. The "Show ratings" toggle (remembered in that browser) reveals each person's rating, expected win chance and the change if picked. After every vote a result line shows the actual changes, for example "CPT Diaz beat SPC Chen. Diaz +16, Chen -16."
- **Elo.** Everyone starts at 1000 (the API accepts an `initial_elo` from 100 to 3000). K is 32, and the update is zero-sum: whatever one person gains, the other loses, so votes never change the sum of all ratings. The math is in `backend/elo.py`:

  ```text
  expected_a = 1 / (1 + 10 ** ((rating_b - rating_a) / 400))
  change     = round(32 * (score_a - expected_a))   # score_a: 1 win, 0.5 draw, 0 loss
  rating_a  += change
  rating_b  -= change
  ```

  Two people at 1000: the winner gets +16 and the loser -16; a draw changes nothing. At 1200 against 1000, a win moves the higher-rated person +8, a loss -24 and a draw -8. Ratings are read at the moment the vote is saved.
- **End of a round.** When the last pair is rated, the round completes and the Rate page shows its standings (start, final and change) with a button to start the next round. "Start new round" ends the current round early, after a confirm; its unrated pairs are cancelled.
- **Roster changes.** People added during a round join from the next round. Deactivating someone cancels their unrated pairs in the current round (completing it if nothing is left) and keeps their history; reactivated people join from the next round. Two active people cannot share the same name and rank (case-insensitive).

## API

Interactive docs are at `/api/docs` and the OpenAPI document is at `/api/openapi.json`, both through the frontend (http://localhost:3000/api/docs) or on the local backend (http://127.0.0.1:8000/api/docs). The docs page loads Swagger UI from cdn.jsdelivr.net, so the browser viewing it needs internet access; `/api/openapi.json` does not.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/health` | `{"status": "ok"}` |
| GET | `/api/personnel?active_only=true` | People by rating; `active_only=false` includes inactive people |
| POST | `/api/personnel` | Add a person: `{name, rank, initial_elo?}` |
| GET | `/api/personnel/{id}` | One person, active or not |
| PATCH | `/api/personnel/{id}` | Edit `name`, `rank`, or `active` (deactivate or reactivate) |
| DELETE | `/api/personnel/{id}` | Deactivate (soft delete, history is kept) |
| GET | `/api/leaderboard` | Active people with wins, losses, draws and matches |
| GET | `/api/stats` | Totals, the current round with its progress, completed round count |
| GET | `/api/rounds?status=active\|completed` | Rounds, newest first |
| POST | `/api/rounds?force=false` | Start a round: `{name?}`; `force=true` ends the active round first |
| GET | `/api/rounds/{id}` | Round, progress, standings and statistics |
| GET | `/api/matchups/next` | The next pair (`status: "ready"`) or `status: "no_active_round"` |
| POST | `/api/matchups/{id}/result` | Record a vote: `{winner_id}`, `null` for a draw |
| POST | `/api/matchups/{id}/skip` | Move an unrated pair to the end of the queue |
| GET | `/api/ratings?limit=20` | Recent ratings, newest first (limit 1 to 200) |
| GET | `/api/elo-progression/by-rounds` | Active people's ratings at their first round and after each completed round |
| GET | `/api/elo-progression/by-ratings` | Active people's ratings after each vote they were in |

Errors return `{"detail": "<message>"}`; 422 responses also carry an `errors` list, and unexpected failures return a generic 500 message. Timestamps are UTC with a `Z` suffix.

## Configuration

All settings are optional.

| Variable | Read by | Default | Purpose |
| --- | --- | --- | --- |
| `ELO_BIND` | compose (`.env`) | `0.0.0.0` | Host address the web UI is published on |
| `ELO_PORT` | compose (`.env`) | `3000` | Host port for the web UI |
| `TS_AUTHKEY` | compose (`.env`), sidecar | empty | Tailscale auth key; empty means log in with the URL in `docker compose logs tailscale` |
| `TS_HOSTNAME` | compose (`.env`), sidecar | `elo` | Machine name on the tailnet |
| `DATABASE_PATH` | backend | `<repo>/data/elo_ratings.db` | DuckDB file; compose sets `/app/data/elo_ratings.db`. The old name `DATABASE_URL` is still read if `DATABASE_PATH` is unset |
| `API_URL` | frontend server | `http://localhost:8000` | Backend address for the `/api` proxy; compose sets `http://backend:8000` |
| `CORS_ORIGINS` | backend | unset (CORS off) | Comma-separated origins allowed to call the backend directly from a browser; not needed when you use the frontend |
| `LOG_LEVEL` | backend | `INFO` | Python logging level |

`docker compose` reads `.env` automatically; `.env.example` lists the compose variables. `DATABASE_PATH`, `API_URL`, `CORS_ORIGINS` and `LOG_LEVEL` are process environment variables: with Docker, set them under the service's `environment:` in `docker-compose.yml` (or a `docker-compose.override.yml`).

## Data and backups

Everything lives in one DuckDB file, `./data/elo_ratings.db`, bind-mounted into the backend container. The backend creates it on first start and upgrades databases from the first release in place, so back up the file before upgrading. On start, the container makes `./data` owned by uid 10001, the user the backend runs as.

To back up, stop the stack first so nothing is half written, then copy the file:

```bash
docker compose stop
cp data/elo_ratings.db elo_ratings-$(date +%F).db
docker compose start
```

If a `data/elo_ratings.db.wal` file is present, copy it with the database. To restore, stop the stack, copy the backup over `data/elo_ratings.db` and start it again.

## Project layout

```text
simple-elo/
  docker-compose.yml        backend, frontend and the optional tailscale sidecar
  .env.example              ELO_BIND, ELO_PORT, TS_AUTHKEY, TS_HOSTNAME
  tailscale/serve.json      HTTPS serve config for the sidecar (Funnel off)
  data/                     elo_ratings.db, created on first start (not in git)
  backend/                  FastAPI and DuckDB, Python 3.12
    main.py                 app factory, lifespan, error handlers
    config.py               settings from the environment
    db.py                   the DuckDB connection, lock and transactions
    migrations.py           schema creation and upgrades
    elo.py                  rating math
    schemas.py              request and response models
    queries.py              SQL shared by the routers
    routers/                personnel, rounds, matchups, reports
    tests/                  pytest suite
    docker-entrypoint.sh    fixes ./data ownership, then drops to the app user
  frontend/                 Next.js 16 app router, React 19, TypeScript, Tailwind CSS, Recharts
    app/                    pages: / (dashboard), /rate, /personnel
    app/api/[...path]/      proxy from /api to the backend
    components/             shared UI (ui.tsx) and per-page components
    lib/                    API client, types, formatting, ranks
  pyproject.toml, uv.lock   repo tooling (pre-commit, detect-secrets)
  elo-army-eval-presentation1.html   concept slides, not part of the app
```

Security notes are in [SECURITY.md](SECURITY.md) and contributor setup is in [CONTRIBUTING.md](CONTRIBUTING.md).
